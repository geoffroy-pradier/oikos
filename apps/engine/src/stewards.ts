import { stewardOperationsPerTick, type ConfigLoader } from '@oikos/config';
import {
  domainEventSchema,
  marketPlaceOrderInputSchema,
  marketPlaceOrderOutputSchema,
  siteCollectInputSchema,
  siteCollectOutputSchema,
  stewardActionFailedSchema,
  stewardOperationSummarySchema,
  type DomainEvent,
  type StewardOperationSummary,
} from '@oikos/contracts';
import { notSanctioned, violatedConstraint, type Db, type GameDatabase } from '@oikos/db';
import {
  collectSite,
  placeOrder,
  type OperationContext,
  type OperationDefinition,
  type OperationResult,
} from '@oikos/operations';
import type { StewardAction } from '@oikos/sim';
import { sql, type ControlledTransaction } from 'kysely';
import { candidates, plan, type Steward, type StewardTick } from './steward-plan';

export type { StewardTick } from './steward-plan';

export interface StewardRun {
  /** Opérations réussies, refusées (notées), et en panne (sans effet ni clé, retentées au passage suivant). */
  acted: number;
  refused: number;
  failed: number;
}

/** Le cœur partagé avec la commande du joueur ; un refus déduit d'une contrainte de la base est un refus métier. */
async function attempt<I, O>(
  operation: OperationDefinition<I, O>,
  context: OperationContext,
  actor: { houseId: string; stewardId?: string },
  input: I,
): Promise<OperationResult<O>> {
  try {
    return await operation.run(context, actor, input);
  } catch (error) {
    const mapped = operation.errorByConstraint?.[violatedConstraint(error) ?? ''];
    if (!mapped) throw error;
    return { ok: false, error: mapped };
  }
}

/** Ce qu'une opération a tenté (la commande et son entrée), son issue, et son résumé pour la fiche du site. */
export interface Performed {
  tried: { command: string; input: unknown };
  result: OperationResult<unknown>;
  summary: StewardOperationSummary;
}

/**
 * Mène l'action d'une règle par le cœur de la commande du joueur (ADR 0009), pour la maison de l'intendant, dans la
 * cité de son site. Les effets restent dans la transaction du contexte : à l'appelant de les garder ou de les annuler.
 * `onTry` reçoit la commande tentée avant qu'elle ne soit menée : une panne la laisse connue de l'appelant.
 * Partagé par l'opération du moteur et la simulation à blanc des règles proposées (#280). `signedBy`, l'intendant en
 * poste qui mène l'opération, signe les ordres posés (#562) ; la simulation, toujours annulée, n'en nomme aucun.
 */
export async function perform(
  context: OperationContext,
  steward: Pick<Steward, 'house_id' | 'site_id'>,
  cityId: string,
  action: StewardAction,
  onTry: (tried: Performed['tried']) => void = () => {},
  signedBy?: string,
): Promise<Performed> {
  const actor = {
    houseId: steward.house_id,
    ...(signedBy !== undefined && { stewardId: signedBy }),
  };
  if (action.kind === 'collect') {
    const input = siteCollectInputSchema.parse({ siteId: steward.site_id });
    onTry({ command: collectSite.name, input });
    const collected = await attempt(collectSite, context, actor, input);
    return {
      tried: { command: collectSite.name, input },
      result: collected.ok
        ? { ok: true, data: siteCollectOutputSchema.parse(collected.data) }
        : collected,
      summary: {
        command: 'site.collect',
        ...(collected.ok && { cycles: collected.data.cycles, outputs: collected.data.outputs }),
      },
    };
  }
  const { side, goodId, price, quantity } = action;
  const input = marketPlaceOrderInputSchema.parse({ cityId, goodId, side, price, quantity });
  onTry({ command: placeOrder.name, input });
  const placed = await attempt(placeOrder, context, actor, input);
  const traded = placed.ok ? placed.data.trades.reduce((sum, fill) => sum + fill.quantity, 0) : 0;
  return {
    tried: { command: placeOrder.name, input },
    result: placed.ok
      ? { ok: true, data: marketPlaceOrderOutputSchema.parse(placed.data) }
      : placed,
    summary: {
      command: 'market.placeOrder',
      side,
      goodId,
      price,
      quantity,
      ...(placed.ok && { traded, status: placed.data.status }),
    },
  };
}

type Outcome = 'done' | 'acted' | 'refused' | 'idle' | 'failed';

/**
 * Une opération d'un intendant, au rang donné du tick, dans sa propre transaction, comme une commande (11.4) : clé
 * d'idempotence tirée de l'intendant, du tick et du rang, journal des commandes au nom de la maison avec l'intendant
 * pour acteur, événements de la commande du joueur, ou `StewardActionFailed` pour un refus.
 * Ordre des verrous (docs/specs/13-moteur-anti-triche.md) : la clé de l'opération, puis l'agora du monde, la trésorerie de la maison et
 * l'intendant, avant ceux du cœur (site, stocks, ordres) ; c'est l'ordre de la clôture (agora, trésorerie, sites,
 * navires, biens, intendants) et des ordres du joueur (agora, trésorerie). Ces verrous ne sont pris que si une règle
 * a quelque chose à faire, vu d'abord sans verrou, puis revu sous eux.
 */
async function operate(
  db: Db,
  tick: StewardTick,
  steward: Steward,
  rank: number,
): Promise<Outcome> {
  const startedAt = performance.now();
  // Le deux-points, refusé par `idempotencyKeySchema`, met cette clé hors de portée du joueur (migration 340).
  const key = `steward:${steward.id}:${tick.index}:${rank}`;
  let trx: ControlledTransaction<GameDatabase> | undefined;
  // Posée par `perform` avant que la commande ne soit menée : une panne garde sa trace d'audit.
  let tried = null as Performed['tried'] | null;
  try {
    trx = await db.startTransaction().setIsolationLevel('read committed').execute();
    // Même verrou que le registre pour la même clé : deux moteurs sur la même opération se suivent.
    const clock = await sql<{ now: Date }>`
      select now() as now, pg_advisory_xact_lock(hashtextextended(${`${steward.user_id}:${key}`}, 0))
    `.execute(trx);
    const now = clock.rows[0]?.now;
    if (!now) throw new Error('The database returned no clock');
    const done = await trx
      .selectFrom('game.steward_operations')
      .select('id')
      .where('steward_id', '=', steward.id)
      .where('tick_index', '=', String(tick.index))
      .where('rank', '=', rank)
      .executeTakeFirst();
    const seen = await trx
      .selectFrom('game.stewards')
      .select('rules_revision')
      .where('id', '=', steward.id)
      .executeTakeFirstOrThrow();
    if (done || !(await plan(trx, tick, steward, seen.rules_revision, now))) {
      await trx.rollback().execute();
      return done ? 'done' : 'idle';
    }
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${tick.worldId}`}, 0))`.execute(
      trx,
    );
    await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('house_id', '=', steward.house_id)
      .where('kind', '=', 'house')
      .forUpdate()
      .execute();
    // Payé, en poste, et ses règles tenues jusqu'à la fin de l'opération : la clôture, un renvoi ou des règles
    // nouvelles attendent. Le compte est relu sous le verrou d'agora (#528) : une exclusion validée depuis la liste
    // des intendants, qui a annulé les ordres du compte sous ce verrou, n'en laisse pas placer un nouveau.
    const held = await trx
      .selectFrom('game.stewards')
      .select('rules_revision')
      .where('id', '=', steward.id)
      .where('dismissed_at', 'is', null)
      .where('unpaid_since', 'is', null)
      .where(notSanctioned(steward.user_id))
      .forShare()
      .executeTakeFirst();
    const chosen = held && (await plan(trx, tick, steward, held.rules_revision, now));
    if (!chosen) {
      await trx.rollback().execute();
      return 'idle';
    }
    const { action, rule, position, revision } = chosen;
    const events: DomainEvent[] = [];
    const effects = await trx.savepoint('operation').execute();
    const context: OperationContext = {
      trx: effects,
      emit: (event) => events.push(domainEventSchema.parse(event)),
      config: tick.config,
      now,
    };
    const performed = await perform(
      context,
      steward,
      chosen.cityId,
      action,
      (t) => {
        tried = t;
      },
      steward.id,
    );
    const { result, summary } = performed;
    if (!result.ok) {
      // Un refus ne laisse aucun effet ni événement de la commande : seulement sa trace et son événement.
      await effects.rollbackToSavepoint('operation').execute();
      events.length = 0;
      events.push(
        stewardActionFailedSchema.parse({
          type: 'StewardActionFailed',
          payload: {
            stewardId: steward.id,
            houseId: steward.house_id,
            siteId: steward.site_id,
            tickIndex: tick.index,
            rank,
            rule,
            command: performed.tried.command,
            code: result.error.code,
          },
        }),
      );
    }
    const logged = await trx
      .insertInto('game.command_log')
      .values({
        user_id: steward.user_id,
        command: performed.tried.command,
        idempotency_key: key,
        input: JSON.stringify(performed.tried.input),
        status: result.ok ? 'ok' : 'rejected',
        error_code: result.ok ? null : result.error.code,
        response: JSON.stringify(result),
        duration_ms: Math.round(performance.now() - startedAt),
        config_version_id: tick.configVersionId,
        steward_id: steward.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('game.steward_operations')
      .values({
        world_id: tick.worldId,
        steward_id: steward.id,
        tick_index: tick.index,
        rank,
        rules_revision: revision,
        rule_position: position,
        status: result.ok ? 'ok' : 'rejected',
        error_code: result.ok ? null : result.error.code,
        summary: JSON.stringify(stewardOperationSummarySchema.parse(summary)),
        command_id: logged.id,
      })
      .execute();
    if (events.length > 0)
      await trx
        .insertInto('game.domain_events')
        .values(
          events.map((event) => ({
            command_id: logged.id,
            type: event.type,
            payload: JSON.stringify(event.payload),
          })),
        )
        .execute();
    await trx.commit().execute();
    return result.ok ? 'acted' : 'refused';
  } catch (error) {
    if (trx && !trx.isCommitted && !trx.isRolledBack)
      await trx
        .rollback()
        .execute()
        .catch((rollbackError: unknown) => console.error('Steward rollback failed', rollbackError));
    console.error(`Steward ${steward.id}: operation ${tick.index}/${rank} failed`, error);
    // Trace d'audit sans clé, comme une commande en panne : l'opération sera retentée sous le même rang.
    if (tried)
      await db
        .insertInto('game.command_log')
        .values({
          user_id: steward.user_id,
          command: tried.command,
          idempotency_key: null,
          input: JSON.stringify(tried.input),
          status: 'failed',
          error_code: 'INTERNAL',
          response: JSON.stringify({
            ok: false,
            error: { code: 'INTERNAL', message: 'Unexpected error.' },
          }),
          duration_ms: Math.round(performance.now() - startedAt),
          config_version_id: tick.configVersionId,
          steward_id: steward.id,
        })
        .execute()
        .catch((logError: unknown) => console.error('Audit log write failed', logError));
    return 'failed';
  }
}

/**
 * Opérations des intendants d'un monde pour un tick (4.4, #279) : chaque intendant actif mène au plus
 * `stewards.operationsPerTick` opérations, une transaction chacune, dans l'ordre de ses règles. Rejouer le même tick
 * ne double rien : un rang déjà mené est passé. Une opération refusée ou en panne ne retient pas les autres
 * intendants ; une panne arrête cet intendant jusqu'au passage suivant.
 */
export async function runStewards(db: Db, tick: StewardTick): Promise<StewardRun> {
  const run: StewardRun = { acted: 0, refused: 0, failed: 0 };
  const perTick = stewardOperationsPerTick(tick.config);
  if (perTick === 0) return run;
  for (const steward of await candidates(db, tick, perTick)) {
    for (let rank = 0; rank < perTick; rank += 1) {
      const outcome = await operate(db, tick, steward, rank);
      if (outcome === 'acted' || outcome === 'refused' || outcome === 'failed') run[outcome] += 1;
      if (outcome === 'idle' || outcome === 'failed') break;
    }
  }
  return run;
}

/**
 * Mène les opérations des intendants de chaque monde pour son dernier tick joué, sous la version de configuration
 * de ce tick. Appelé à chaque passage du moteur, après les ticks et les clôtures : une opération manquée (moteur
 * arrêté, panne) est menée au passage suivant tant que le tick est le dernier, puis ne l'est plus. L'échec d'un
 * monde n'arrête pas les autres.
 */
export async function runAllStewards(
  db: Db,
  { config }: { config: Pick<ConfigLoader, 'byId'> },
): Promise<{ worldId: string; run?: StewardRun; error?: string }[]> {
  // Mondes illisibles (base indisponible) : signalé et rien à faire, sans faire échouer le passage du moteur.
  const worlds = await db
    .selectFrom('game.worlds')
    .select('id')
    .orderBy('id')
    .execute()
    .catch((error: unknown) => {
      console.error('Stewards: worlds could not be read', error);
      return [];
    });
  const results: { worldId: string; run?: StewardRun; error?: string }[] = [];
  for (const { id: worldId } of worlds) {
    try {
      const last = await db
        .selectFrom('game.ticks')
        .select(['index', 'config_version_id'])
        .where('world_id', '=', worldId)
        .orderBy('index', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (!last) continue;
      const loaded = await config.byId(last.config_version_id);
      const tick = {
        worldId,
        index: Number(last.index),
        configVersionId: loaded.id,
        config: loaded.config,
      };
      results.push({ worldId, run: await runStewards(db, tick) });
    } catch (error) {
      console.error(`World ${worldId}: stewards could not act`, error);
      results.push({ worldId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
