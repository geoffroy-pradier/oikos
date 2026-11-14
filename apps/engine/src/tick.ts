import { randomBytes } from 'node:crypto';
import type { ConfigLoader, GameConfig, LoadedConfig } from '@oikos/config';
import type { Db } from '@oikos/db';
import { createRng, isDailyClose, isSeasonSwitch, tickStart, type Rng } from '@oikos/sim';
import { sql } from 'kysely';

export interface TickContext {
  /** Transaction du tick : toute écriture passe par elle. */
  trx: Db;
  worldId: string;
  index: number;
  /** Instant de jeu du tick (début de son intervalle), quel que soit le moment réel de l'exécution. */
  scheduledAt: Date;
  /** Configuration figée : la seule version lue par ce tick. */
  config: Readonly<GameConfig>;
  /** Aléa déterministe, initialisé par la graine du tick. Seule source de hasard autorisée. */
  rng: Rng;
  dailyClose: boolean;
  seasonSwitch: boolean;
}

/** Une étape du tick. Elle rend un résumé déterministe de ses effets, enregistré avec le tick. */
export interface TickStep {
  name: string;
  run(context: TickContext): Promise<Record<string, unknown>>;
}

export interface TickRequest {
  worldId: string;
  index: number;
  /** Instant de jeu du tick : exactement le début de son intervalle. */
  scheduledAt: Date;
  /** Chargeur de configuration (`createConfigLoader(db)`). */
  config: Pick<ConfigLoader, 'at' | 'byId'>;
  steps: readonly TickStep[];
  /** Graine du tick. Par défaut : 128 bits d'aléa du système, imprévisibles avant le tick. */
  newSeed?: () => string;
  /**
   * Instant présent : un tick ne se joue qu'une fois son instant de jeu atteint. Obligatoire, pour que
   * l'appelant choisisse son horloge (celle de la base pour le moteur), jamais celle du processus par défaut.
   */
  now: () => Date;
}

export interface TickOutcome {
  /** `skipped` : le tick avait déjà été joué, rien n'a été refait. */
  status: 'done' | 'skipped';
  seed: string;
  configVersionId: string;
  summary: Record<string, unknown>;
}

const systemSeed = () => randomBytes(16).toString('hex');

/** Refuse une requête mal formée avant toute écriture. */
function check(request: TickRequest, loaded: LoadedConfig): void {
  const { index, scheduledAt, steps } = request;
  const { tickMinutes } = loaded.config.clock;
  if (!Number.isSafeInteger(index) || index < 0)
    throw new RangeError(`Invalid tick index ${index}`);
  if (tickStart(index, tickMinutes).getTime() !== scheduledAt.getTime()) {
    throw new Error(
      `Tick ${index} does not start at ${scheduledAt.toISOString()} for ${tickMinutes}-minute ticks`,
    );
  }
  const names = steps.map((step) => step.name);
  if (new Set(names).size !== names.length)
    throw new Error(`Duplicate tick step name in [${names.join(', ')}]`);
}

/** Applique les étapes d'un tick dans la transaction fournie, sans rien enregistrer d'autre. */
async function applySteps(trx: Db, request: TickRequest, loaded: LoadedConfig, seed: string) {
  const { worldId, index, scheduledAt } = request;
  const clock = loaded.config.clock;
  const context: TickContext = {
    trx,
    worldId,
    index,
    scheduledAt,
    config: loaded.config,
    // Un seul générateur pour tout le tick : chaque étape poursuit la suite de la précédente.
    rng: createRng(seed),
    dailyClose: isDailyClose(index, clock),
    seasonSwitch: isSeasonSwitch(index, clock),
  };
  const summary: Record<string, unknown> = {};
  for (const step of request.steps) summary[step.name] = await step.run(context);
  // Le résumé est rendu tel qu'il sera relu en base (aller-retour JSON) : comparable d'un rejeu à l'autre.
  return { context, summary: JSON.parse(JSON.stringify(summary)) as Record<string, unknown> };
}

/**
 * Joue un tick une fois et une seule : étapes, effets et ligne `game.ticks` sont validés ensemble.
 * Un tick déjà joué est ignoré ; un tick en échec n'a rien écrit et peut être repris tel quel.
 * Chaque tentative laisse une ligne de télémétrie avec sa durée, écrite au mieux : un échec de
 * télémétrie ne change jamais l'issue du tick.
 */
export async function runTick(db: Db, request: TickRequest): Promise<TickOutcome> {
  const startedAt = performance.now();
  const { worldId, index, scheduledAt } = request;
  const record = (status: 'done' | 'skipped' | 'failed', error: string | null = null) =>
    db
      .insertInto('telemetry.tick_runs')
      .values({
        world_id: worldId,
        tick_index: index,
        status,
        duration_ms: Math.round(performance.now() - startedAt),
        error,
      })
      .execute()
      .catch((telemetryError: unknown) =>
        console.error('Tick telemetry write failed', telemetryError),
      );

  let outcome: TickOutcome;
  try {
    if (scheduledAt.getTime() > request.now().getTime()) {
      throw new Error(`Tick ${index} is not due before ${scheduledAt.toISOString()}`);
    }
    // La configuration est chargée AVANT d'ouvrir la transaction : le chargeur utilise sa propre connexion,
    // et la demander en tenant déjà celle du tick épuiserait le pool sous charge.
    const loaded = await request.config.at(scheduledAt);
    check(request, loaded);

    outcome = await db.transaction().execute(async (trx): Promise<TickOutcome> => {
      // Deux moteurs sur le même tick s'exécutent l'un après l'autre : le second constate qu'il est joué.
      await sql`select pg_advisory_xact_lock(hashtextextended(${`tick:${worldId}:${index}`}, 0))`.execute(
        trx,
      );
      const played = await trx
        .selectFrom('game.ticks')
        .select(['seed', 'config_version_id', 'summary'])
        .where('world_id', '=', worldId)
        .where('index', '=', String(index))
        .executeTakeFirst();
      if (played) {
        return {
          status: 'skipped',
          seed: played.seed,
          configVersionId: played.config_version_id,
          summary: played.summary as Record<string, unknown>,
        };
      }

      const seed = (request.newSeed ?? systemSeed)();
      const { context, summary } = await applySteps(trx, request, loaded, seed);
      await trx
        .insertInto('game.ticks')
        .values({
          world_id: worldId,
          index,
          scheduled_at: scheduledAt,
          seed,
          config_version_id: loaded.id,
          daily_close: context.dailyClose,
          season_switch: context.seasonSwitch,
          summary: JSON.stringify(summary),
        })
        .execute();
      return { status: 'done', seed, configVersionId: loaded.id, summary };
    });
  } catch (error) {
    if (Number.isSafeInteger(index)) {
      await record('failed', String(error instanceof Error ? error.message : error).slice(0, 500));
    }
    throw error;
  }
  await record(outcome.status);
  return outcome;
}

class DryRun extends Error {}

/**
 * Applique les étapes d'un tick sur l'état courant avec une graine donnée, puis annule tout.
 * Même graine, même état, même version de configuration : même résumé. Pour rejouer un tick déjà
 * joué, passer la graine ET la version qu'il a enregistrées (`configVersionId`) : la version active
 * à l'instant du tick a pu changer depuis, celle du tick enregistré fait foi.
 */
export async function dryRunTick(
  db: Db,
  request: TickRequest,
  replay: { seed: string; configVersionId?: string },
): Promise<Record<string, unknown>> {
  const loaded = replay.configVersionId
    ? await request.config.byId(replay.configVersionId)
    : await request.config.at(request.scheduledAt);
  check(request, loaded);
  let summary: Record<string, unknown> = {};
  await db
    .transaction()
    .execute(async (trx) => {
      ({ summary } = await applySteps(trx, request, loaded, replay.seed));
      throw new DryRun();
    })
    .catch((error: unknown) => {
      if (!(error instanceof DryRun)) throw error;
    });
  return summary;
}
