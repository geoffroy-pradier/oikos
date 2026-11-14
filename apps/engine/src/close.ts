import type { ConfigLoader, GameConfig } from '@oikos/config';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

export interface CloseContext {
  /** Transaction de la clôture : toute écriture passe par elle. */
  trx: Db;
  worldId: string;
  /** Jour de jeu que la clôture ouvre (`gameDayAt`). */
  gameDay: number;
  /** Instant de jeu de la clôture, quel que soit le moment réel de l'exécution. */
  closeAt: Date;
  /** Configuration en vigueur à l'instant de la clôture, version activée à cet instant comprise. */
  config: Readonly<GameConfig>;
}

/** Une étape de la clôture. Elle rend un résumé de ses effets, enregistré avec la clôture. */
export interface CloseStep {
  name: string;
  run(context: CloseContext): Promise<Record<string, unknown>>;
}

export interface CloseRequest {
  worldId: string;
  gameDay: number;
  closeAt: Date;
  config: Pick<ConfigLoader, 'at'>;
  steps: readonly CloseStep[];
  /** Instant présent : une clôture ne se joue qu'une fois son instant de jeu atteint. */
  now: Date;
}

export interface CloseOutcome {
  /** `skipped` : la clôture avait déjà été jouée, rien n'a été refait. */
  status: 'done' | 'skipped';
  summary: Record<string, unknown>;
}

/**
 * Joue la clôture d'un jour de jeu une fois et une seule (docs/specs/03-boucles-progression.md) :
 * étapes, effets et ligne `game.daily_closes` sont validés ensemble. Une clôture déjà jouée est
 * ignorée ; une clôture en échec n'a rien écrit et peut être reprise telle quelle.
 */
export async function runDailyClose(db: Db, request: CloseRequest): Promise<CloseOutcome> {
  const { worldId, gameDay, closeAt, steps, now } = request;
  if (!Number.isSafeInteger(gameDay) || gameDay < 0)
    throw new RangeError(`Invalid game day ${gameDay}`);
  if (closeAt.getTime() > now.getTime())
    throw new Error(`Daily close ${gameDay} is not due before ${closeAt.toISOString()}`);
  // Chargée avant la transaction, comme pour un tick : le chargeur a sa propre connexion. La version
  // programmée « à la prochaine clôture » est en vigueur à cet instant : activation d'abord.
  const loaded = await request.config.at(closeAt);

  return db.transaction().execute(async (trx): Promise<CloseOutcome> => {
    // Deux moteurs sur la même clôture s'exécutent l'un après l'autre : le second constate qu'elle est jouée.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`close:${worldId}:${gameDay}`}, 0))`.execute(
      trx,
    );
    const played = await trx
      .selectFrom('game.daily_closes')
      .select('summary')
      .where('world_id', '=', worldId)
      .where('game_day', '=', gameDay)
      .executeTakeFirst();
    if (played) return { status: 'skipped', summary: played.summary as Record<string, unknown> };

    const context: CloseContext = { trx, worldId, gameDay, closeAt, config: loaded.config };
    const raw: Record<string, unknown> = {};
    for (const step of steps) raw[step.name] = await step.run(context);
    const summary = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    await trx
      .insertInto('game.daily_closes')
      .values({
        world_id: worldId,
        game_day: gameDay,
        close_at: closeAt,
        config_version_id: loaded.id,
        summary: JSON.stringify(summary),
      })
      .execute();
    return { status: 'done', summary };
  });
}
