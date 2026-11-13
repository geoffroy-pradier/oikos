import { randomBytes } from 'node:crypto';
import type { GameConfig, LoadedConfig } from '@oikos/config';
import type { Db } from '@oikos/db';
import { createRng, isDailyClose, isSeasonSwitch, tickIndexAt, type Rng } from '@oikos/sim';
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
  scheduledAt: Date;
  /** Charge la configuration active à un instant (`createConfigLoader(db).at`). */
  loadConfig: (instant: Date) => Promise<LoadedConfig>;
  steps: readonly TickStep[];
  /** Graine du tick. Par défaut : 128 bits d'aléa du système, imprévisibles avant le tick. */
  newSeed?: () => string;
}

export interface TickOutcome {
  /** `skipped` : le tick avait déjà été joué, rien n'a été refait. */
  status: 'done' | 'skipped';
  seed: string;
  configVersionId: string;
  summary: Record<string, unknown>;
}

const systemSeed = () => randomBytes(16).toString('hex');

/** Applique les étapes d'un tick dans la transaction fournie, sans rien enregistrer d'autre. */
async function applySteps(trx: Db, request: TickRequest, seed: string) {
  const { worldId, index, scheduledAt } = request;
  const loaded = await request.loadConfig(scheduledAt);
  const clock = loaded.config.clock;
  if (tickIndexAt(scheduledAt, clock.tickMinutes) !== index) {
    throw new Error(
      `Tick ${index} does not match ${scheduledAt.toISOString()} for ${clock.tickMinutes}-minute ticks`,
    );
  }
  const context: TickContext = {
    trx,
    worldId,
    index,
    scheduledAt,
    config: loaded.config,
    rng: createRng(seed),
    dailyClose: isDailyClose(index, clock),
    seasonSwitch: isSeasonSwitch(index, clock),
  };
  const summary: Record<string, unknown> = {};
  for (const step of request.steps) summary[step.name] = await step.run(context);
  return { context, loaded, summary };
}

/**
 * Joue un tick une fois et une seule : étapes, effets et ligne `game.ticks` sont validés ensemble.
 * Un tick déjà joué est ignoré ; un tick en échec n'a rien écrit et peut être repris tel quel.
 * Chaque tentative laisse une ligne de télémétrie avec sa durée.
 */
export async function runTick(db: Db, request: TickRequest): Promise<TickOutcome> {
  const startedAt = performance.now();
  const { worldId, index } = request;
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
      .execute();
  try {
    const outcome = await db.transaction().execute(async (trx): Promise<TickOutcome> => {
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
      const { context, loaded, summary } = await applySteps(trx, request, seed);
      await trx
        .insertInto('game.ticks')
        .values({
          world_id: worldId,
          index,
          scheduled_at: request.scheduledAt,
          seed,
          config_version_id: loaded.id,
          daily_close: context.dailyClose,
          season_switch: context.seasonSwitch,
          summary: JSON.stringify(summary),
        })
        .execute();
      return { status: 'done', seed, configVersionId: loaded.id, summary };
    });
    await record(outcome.status);
    return outcome;
  } catch (error) {
    await record(
      'failed',
      String(error instanceof Error ? error.message : error).slice(0, 500),
    ).catch((telemetryError: unknown) =>
      console.error('Tick telemetry write failed', telemetryError),
    );
    throw error;
  }
}

class DryRun extends Error {}

/**
 * Rejoue les étapes d'un tick avec une graine donnée, sur l'état courant, puis annule tout.
 * Même graine, même état, même configuration : même résumé. Sert aux tests et à l'audit d'un tick contesté.
 */
export async function dryRunTick(
  db: Db,
  request: TickRequest,
  seed: string,
): Promise<Record<string, unknown>> {
  let summary: Record<string, unknown> = {};
  await db
    .transaction()
    .execute(async (trx) => {
      ({ summary } = await applySteps(trx, request, seed));
      throw new DryRun();
    })
    .catch((error: unknown) => {
      if (!(error instanceof DryRun)) throw error;
    });
  return summary;
}
