import { stewardOperationsPerTick, stewardRefusalRestTicks, type GameConfig } from '@oikos/config';
import {
  domainEventSchema,
  MAX_ORDER_QUANTITY,
  stewardRulesSchema,
  type DomainEvent,
} from '@oikos/contracts';
import type { Db, GameDatabase } from '@oikos/db';
import { cancelLockedOrders, lockAgora, type OperationContext } from '@oikos/operations';
import { nextStewardOperation, type StewardPlanRule } from '@oikos/sim';
import { sql, type ControlledTransaction } from 'kysely';
import { sightOf, type StewardTick } from './steward-plan';
import { perform, type StewardRun } from './stewards';

/** Un site d'une maison PNJ, avec la cité et la filière dont la configuration tient ses règles. */
export interface NpcSite {
  site_id: string;
  house_id: string;
  recipe_id: string;
  slug: string;
  chain_id: string;
}

/**
 * Règles d'un site d'une maison PNJ (#716) : celles de la recette du site dans la filière de sa maison
 * (`npcHouses.<cité>.chains[].rules`), relues par la grammaire des intendants (`stewardRulesSchema`, #278). Aucune pour
 * une cité, une filière ou une recette que la configuration ne nomme plus, ou des règles que le contrat refuse.
 */
export function npcSiteRules(config: GameConfig, site: Omit<NpcSite, 'site_id' | 'house_id'>) {
  const city = Object.hasOwn(config.npcHouses, site.slug) ? config.npcHouses[site.slug] : undefined;
  const rules = city?.chains.find((chain) => chain.id === site.chain_id)?.rules ?? {};
  const parsed = stewardRulesSchema.safeParse(
    Object.hasOwn(rules, site.recipe_id) ? rules[site.recipe_id] : [],
  );
  return parsed.success ? (parsed.data as StewardPlanRule[]) : [];
}

/**
 * Sites des maisons PNJ dans l'ordre de leur fondation, sans dépendre d'aucun identifiant tiré au hasard (#717) : les
 * maisons d'une même clôture et les sites d'une même fondation partagent leur instant, et leurs identifiants (uuid v7)
 * ne départagent pas deux écritures d'une même milliseconde. Après l'instant de fondation, la cité, puis la filière
 * et la recette à leur rang dans la configuration (celui de la fondation : `dueNpcHouses`), puis l'instant de création
 * du site ; l'identifiant ne départage que deux sites d'une même recette, interchangeables. Mêmes graine et
 * configuration, mêmes opérations dans le même ordre. Sans entrée-sortie.
 */
export function npcFoundingOrder<
  T extends {
    slug: string;
    chain_id: string;
    recipe_id: string;
    founded_at: Date;
    created_at: Date;
    site_id: string;
  },
>(config: GameConfig, sites: readonly T[]): T[] {
  const rank = (site: T) => {
    const chains = Object.hasOwn(config.npcHouses, site.slug)
      ? (config.npcHouses[site.slug]?.chains ?? [])
      : [];
    const chain = chains.findIndex((candidate) => candidate.id === site.chain_id);
    const recipes = Object.keys(chains[chain]?.sites ?? {});
    return [chain < 0 ? chains.length : chain, recipes.indexOf(site.recipe_id)];
  };
  const by = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...sites].sort((a, b) => {
    const [ca = 0, ra = 0] = rank(a);
    const [cb = 0, rb = 0] = rank(b);
    return (
      a.founded_at.getTime() - b.founded_at.getTime() ||
      by(a.slug, b.slug) ||
      ca - cb ||
      ra - rb ||
      a.created_at.getTime() - b.created_at.getTime() ||
      by(a.site_id, b.site_id)
    );
  });
}

/** Un ordre ouvert d'une maison PNJ, tel que la justification le lit. */
export interface NpcOpenOrder {
  side: 'buy' | 'sell';
  good_id: string;
  price: string | number;
}

/**
 * Un ordre ouvert d'une maison PNJ est-il justifié par la configuration en vigueur (#717) ? Sans entrée-sortie. Jamais
 * au-dessus du prix de référence de son bien (un bien que la configuration ne connaît plus n'en a pas). Une maison qui
 * se liquide (aucun site ouvert) garde ses ventes et aucun achat. Sinon, une règle des sites ouverts (`rules`) poserait
 * cet ordre : une vente du bien à ce prix plancher, ou un achat du bien à ce prix plafond. Une règle, une filière ou
 * une cité retirée, un prix changé ou un prix de référence baissé ne justifient donc plus les ordres d'avant.
 */
export function npcOrderJustified(
  order: NpcOpenOrder,
  rules: readonly StewardPlanRule[],
  reference: number | undefined,
  liquidating: boolean,
) {
  const price = Number(order.price);
  if (reference === undefined || price > reference) return false;
  if (liquidating) return order.side === 'sell';
  return rules.some((rule) =>
    order.side === 'sell'
      ? rule.kind === 'sell' && rule.goodId === order.good_id && rule.minPriceOboles === price
      : rule.kind === 'buy' && rule.goodId === order.good_id && rule.maxPriceOboles === price,
  );
}

/**
 * Ordres ouverts des maisons PNJ du monde que la configuration du tick ne justifie plus (`npcOrderJustified`), d'après
 * les règles de leurs sites ouverts.
 */
async function unjustifiedNpcOrders(trx: Db, config: GameConfig, worldId: string, lock = false) {
  const query = trx
    .selectFrom('game.orders as o')
    .innerJoin('game.npc_houses as n', 'n.house_id', 'o.house_id')
    .innerJoin('game.cities as c', 'c.id', 'n.city_id')
    .select(['o.id', 'o.world_id', 'o.house_id', 'o.city_id', 'o.good_id', 'o.side', 'o.price'])
    .select(['o.remaining', 'c.slug', 'n.chain_id'])
    .where('o.world_id', '=', worldId)
    .where('o.status', '=', 'open')
    .orderBy('o.id');
  const orders = await (lock ? query.forUpdate('o') : query).execute();
  if (orders.length === 0) return [];
  const sites = await trx
    .selectFrom('game.sites')
    .select(['house_id', 'recipe_id'])
    .where('house_id', 'in', [...new Set(orders.map((order) => order.house_id))])
    .where('closed_at', 'is', null)
    .execute();
  const reference = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
  return orders.filter((order) => {
    const open = sites.filter((site) => site.house_id === order.house_id);
    const rules = open.flatMap((site) =>
      npcSiteRules(config, {
        slug: order.slug,
        chain_id: order.chain_id,
        recipe_id: site.recipe_id,
      }),
    );
    return !npcOrderJustified(order, rules, reference.get(order.good_id), open.length === 0);
  });
}

/**
 * Annule les ordres ouverts des maisons PNJ que la configuration ne justifie plus (#717), comme `steward.setRules`
 * pour un intendant : réservation levée, séquestre rendu à la trésorerie, un `OrderCancelled` par ordre, sans
 * commande. Vus d'abord sans verrou ; s'il y en a, relus sous le verrou de l'agora, puis la trésorerie (l'ordre des
 * opérations), dans une transaction. Rend le nombre d'ordres annulés ; une panne est signalée, sans retenir les règles.
 */
export async function cancelUnjustifiedNpcOrders(db: Db, tick: StewardTick): Promise<number> {
  if ((await unjustifiedNpcOrders(db, tick.config, tick.worldId)).length === 0) return 0;
  try {
    return await db.transaction().execute(async (trx) => {
      await lockAgora(trx, tick.worldId);
      const orders = await unjustifiedNpcOrders(trx, tick.config, tick.worldId, true);
      const events: DomainEvent[] = [];
      await cancelLockedOrders(
        trx,
        orders,
        (event) => events.push(domainEventSchema.parse(event)),
        (houseId) => ({ houseId, cause: 'npc_house.rules', configVersionId: tick.configVersionId }),
      );
      if (events.length > 0)
        await trx
          .insertInto('game.domain_events')
          .values(
            events.map((event) => ({
              command_id: null,
              type: event.type,
              payload: JSON.stringify(event.payload),
            })),
          )
          .execute();
      return orders.length;
    });
  } catch (error) {
    console.error(`World ${tick.worldId}: unjustified NPC orders could not be cancelled`, error);
    return 0;
  }
}

/** Dernière opération du site : la position de sa file et la clé d'idempotence de son rang. */
type Queue = {
  config_version_id: string;
  tick_index: string;
  rank: number;
  rule_position: number;
  refused: Record<string, number>;
};

/**
 * Opération suivante d'un site, sans verrou ni écriture : sous la même version de configuration, la file repart de
 * la règle qui suit la dernière menée, sinon de la première ; une règle refusée sous cette version à ce tick ou dans
 * les `stewards.refusalRestTicks` précédents se repose, comme celle d'un intendant (#279, #621).
 */
async function plan(
  trx: Db,
  tick: StewardTick,
  site: NpcSite,
  rules: StewardPlanRule[],
  queue: Queue | undefined,
  now: Date,
) {
  const same = queue?.config_version_id === tick.configVersionId;
  const start = same && queue ? queue.rule_position + 1 : 0;
  const rest = stewardRefusalRestTicks(tick.config);
  const resting = new Set(
    Object.entries(same && rest > 0 ? (queue?.refused ?? {}) : {})
      .filter(([, refusedAt]) => refusedAt >= tick.index - rest)
      .map(([position]) => Number(position)),
  );
  const steward = { house_id: site.house_id, site_id: site.site_id };
  const { sight, cityId } = await sightOf(trx, tick.config, steward, rules, now);
  const next = nextStewardOperation(rules, start, sight, MAX_ORDER_QUANTITY, resting);
  return next && { ...next, cityId, same };
}

type Outcome = 'done' | 'acted' | 'refused' | 'idle' | 'failed';

/**
 * Une opération d'un site d'une maison PNJ, au rang donné du tick, dans sa propre transaction : le cœur de la commande
 * du joueur (ADR 0009) pour la maison PNJ, sans intendant ni journal des commandes (une maison PNJ n'a pas de compte).
 * Ordre des verrous : celui du site (il tient sa file, comme la clé d'une opération d'intendant), puis l'agora du monde
 * et la trésorerie de la maison, avant ceux du cœur. La file du site, relue sous ce verrou, est la clé d'idempotence :
 * un rang déjà mené est passé, et la garde de la base refuse qu'une opération ne suive pas la précédente.
 * Un refus n'a aucun effet que sa trace dans la file ; ses événements de domaine sont ceux de la commande, sans
 * commande (`command_id` nul), comme ceux de la clôture.
 */
async function operate(
  db: Db,
  tick: StewardTick,
  site: NpcSite,
  rules: StewardPlanRule[],
  rank: number,
): Promise<Outcome> {
  let trx: ControlledTransaction<GameDatabase> | undefined;
  try {
    trx = await db.startTransaction().setIsolationLevel('read committed').execute();
    const clock = await sql<{ now: Date }>`
      select now() as now, pg_advisory_xact_lock(hashtextextended(${`npc-site:${site.site_id}`}, 0))
    `.execute(trx);
    const now = clock.rows[0]?.now;
    if (!now) throw new Error('The database returned no clock');
    const queue = await trx
      .selectFrom('game.npc_site_queues')
      .select(['config_version_id', 'tick_index', 'rank', 'rule_position', 'refused'])
      .where('site_id', '=', site.site_id)
      .executeTakeFirst();
    const done =
      queue &&
      (Number(queue.tick_index) > tick.index ||
        (Number(queue.tick_index) === tick.index && queue.rank >= rank));
    if (done || !(await plan(trx, tick, site, rules, queue, now))) {
      await trx.rollback().execute();
      return done ? 'done' : 'idle';
    }
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${tick.worldId}`}, 0))`.execute(
      trx,
    );
    await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('house_id', '=', site.house_id)
      .where('kind', '=', 'house')
      .forUpdate()
      .execute();
    const chosen = await plan(trx, tick, site, rules, queue, now);
    if (!chosen) {
      await trx.rollback().execute();
      return 'idle';
    }
    const events: DomainEvent[] = [];
    const effects = await trx.savepoint('operation').execute();
    const context: OperationContext = {
      trx: effects,
      emit: (event) => events.push(domainEventSchema.parse(event)),
      config: tick.config,
      now,
    };
    const { result } = await perform(context, site, chosen.cityId, chosen.action);
    if (!result.ok) {
      await effects.rollbackToSavepoint('operation').execute();
      events.length = 0;
    }
    const refused = {
      ...(chosen.same ? queue?.refused : {}),
      ...(!result.ok && { [chosen.position]: tick.index }),
    };
    const values = {
      config_version_id: tick.configVersionId,
      tick_index: tick.index,
      rank,
      rule_position: chosen.position,
      error_code: result.ok ? null : result.error.code,
      refused: JSON.stringify(refused),
    };
    await trx
      .insertInto('game.npc_site_queues')
      .values({ site_id: site.site_id, world_id: tick.worldId, house_id: site.house_id, ...values })
      .onConflict((conflict) => conflict.column('site_id').doUpdateSet(values))
      .execute();
    if (events.length > 0)
      await trx
        .insertInto('game.domain_events')
        .values(
          events.map((event) => ({
            command_id: null,
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
        .catch((rollbackError: unknown) => console.error('NPC rollback failed', rollbackError));
    console.error(`NPC site ${site.site_id}: operation ${tick.index}/${rank} failed`, error);
    return 'failed';
  }
}

/**
 * Règles des maisons PNJ de secours d'un monde pour un tick (8.3, 4.4 ; #716), au pas des intendants : chaque site
 * d'une maison PNJ qui a des règles mène au plus `stewards.operationsPerTick` opérations, une transaction chacune,
 * dans l'ordre de ses règles, sans salaire ni intendant. Rejouer le même tick ne double rien. Une opération refusée
 * ou en panne ne retient pas les autres sites ; une panne arrête ce site jusqu'au passage suivant. D'abord, les ordres
 * que la configuration du tick ne justifie plus sont annulés (#717), même pour une version sans maisons PNJ.
 */
export async function runNpcHouseRules(db: Db, tick: StewardTick): Promise<StewardRun> {
  const run: StewardRun = { acted: 0, refused: 0, failed: 0 };
  await cancelUnjustifiedNpcOrders(db, tick);
  const perTick = stewardOperationsPerTick(tick.config);
  if (perTick === 0 || Object.keys(tick.config.npcHouses).length === 0) return run;
  const sites = await db
    .selectFrom('game.npc_houses as n')
    .innerJoin('game.sites as s', 's.house_id', 'n.house_id')
    .innerJoin('game.cities as c', 'c.id', 'n.city_id')
    .leftJoin('game.npc_site_queues as q', 'q.site_id', 's.id')
    .select(['s.id as site_id', 's.house_id', 's.recipe_id', 'c.slug', 'n.chain_id'])
    .select(['n.founded_at', 's.created_at'])
    .where('n.world_id', '=', tick.worldId)
    // Un site fermé par le retrait (#717) ne mène pas ses règles.
    .where('s.closed_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('q.tick_index', 'is', null),
        eb('q.tick_index', '<', String(tick.index)),
        eb.and([eb('q.tick_index', '=', String(tick.index)), eb('q.rank', '<', perTick - 1)]),
      ]),
    )
    .orderBy('n.founded_at')
    .orderBy('s.created_at')
    .orderBy('s.id')
    .execute();
  for (const site of npcFoundingOrder(tick.config, sites)) {
    const rules = npcSiteRules(tick.config, site);
    if (rules.length === 0) continue;
    for (let rank = 0; rank < perTick; rank += 1) {
      const outcome = await operate(db, tick, site, rules, rank);
      if (outcome === 'acted' || outcome === 'refused' || outcome === 'failed') run[outcome] += 1;
      if (outcome === 'idle' || outcome === 'failed') break;
    }
  }
  return run;
}
