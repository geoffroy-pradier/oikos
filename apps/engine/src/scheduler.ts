import { ConfigError, type ConfigLoader } from '@oikos/config';
import type { Db } from '@oikos/db';
import { dailyCloseAt, gameDayAt, tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { runDailyClose, type CloseStep } from './close';
import { runTick, type TickStep } from './tick';

/** Nombre maximal de ticks rattrapés en un passage, après une panne du moteur (limite technique). */
export const MAX_CATCH_UP_TICKS = 36;

/**
 * Indices des ticks à jouer maintenant, dans l'ordre : du premier non joué jusqu'au tick en cours.
 * Un monde qui n'a encore joué aucun tick commence au tick en cours. Le rattrapage est borné : après une
 * longue panne, les passages suivants continuent là où celui-ci s'arrête.
 */
export function dueTicks(
  lastPlayed: number | null,
  current: number,
  limit = MAX_CATCH_UP_TICKS,
): number[] {
  const first = lastPlayed === null ? current : lastPlayed + 1;
  const count = Math.max(0, Math.min(current - first + 1, limit));
  return Array.from({ length: count }, (_, offset) => first + offset);
}

/**
 * Instant présent du planificateur : l'horloge de la base. Tous les moteurs lisent la même, qui date
 * aussi les écritures du jeu ; une horloge de processus mal réglée ne décale ni tick ni clôture.
 */
export async function databaseNow(db: Db): Promise<Date> {
  const { rows } = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(db);
  const now = rows[0]?.now;
  if (!(now instanceof Date)) throw new Error('The database did not return its clock');
  return now;
}

export interface AdvanceRequest {
  worldId: string;
  now: Date;
  config: Pick<ConfigLoader, 'at' | 'byId'>;
  steps: readonly TickStep[];
}

/**
 * Fait avancer un monde jusqu'au tick en cours, un tick après l'autre et dans l'ordre, et rend les
 * indices des ticks que cet appel a lui-même joués. Deux moteurs
 * peuvent s'exécuter en même temps : chaque tick n'est appliqué qu'une fois (`runTick`), et aucun
 * ne passe au tick suivant avant que le précédent soit joué.
 */
export async function advanceWorld(db: Db, request: AdvanceRequest): Promise<number[]> {
  const { worldId, now, config, steps } = request;
  const { tickMinutes } = (await config.at(now)).config.clock;
  const last = await db
    .selectFrom('game.ticks')
    .select('index')
    .where('world_id', '=', worldId)
    .orderBy('index', 'desc')
    .limit(1)
    .executeTakeFirst();
  const current = tickIndexAt(now, tickMinutes);
  if (last && current < Number(last.index)) {
    // Horloge qui recule, ou durée de tick modifiée : rien à jouer, mais cela ne doit pas passer inaperçu.
    console.warn(`World ${worldId}: current tick ${current} is behind last played ${last.index}`);
  }
  if (!last) {
    // Monde neuf : si la configuration n'était pas encore en vigueur au début du tick en cours
    // (premier démarrage), le monde commence au tick suivant.
    const ready = await config.at(tickStart(current, tickMinutes)).then(
      () => true,
      (error: unknown) => {
        if (error instanceof ConfigError) return false;
        throw error;
      },
    );
    if (!ready) return [];
  }
  const played: number[] = [];
  for (const index of dueTicks(last ? Number(last.index) : null, current)) {
    // Un échec arrête le rattrapage : le tick fautif sera repris au prochain passage, jamais sauté.
    const outcome = await runTick(db, {
      worldId,
      index,
      scheduledAt: tickStart(index, tickMinutes),
      config,
      steps,
      now: () => now,
    });
    // Un tick déjà joué par un autre moteur n'est pas compté ici.
    if (outcome.status === 'done') played.push(index);
  }
  return played;
}

export interface CloseWorldRequest {
  worldId: string;
  now: Date;
  config: Pick<ConfigLoader, 'at'>;
  steps: readonly CloseStep[];
}

/**
 * Joue la clôture du jour de jeu en cours d'un monde si elle ne l'est pas encore, et rend le jour que
 * cet appel a lui-même clos. Une clôture manquée (moteur arrêté à l'heure dite) est rattrapée au
 * premier passage, une seule fois : après une panne de plusieurs jours, seule la clôture du jour en
 * cours est jouée, les jours manqués n'en ont pas et ne coûtent rien aux maisons. Rien ici ne dépend
 * de la durée du tick : le jour de jeu et l'instant de sa clôture se déduisent de l'heure de clôture
 * et du fuseau, en vigueur à l'instant présent.
 */
export async function closeWorld(db: Db, request: CloseWorldRequest): Promise<number[]> {
  const { worldId, now, config, steps } = request;
  const { clock } = (await config.at(now)).config;
  const last = await db
    .selectFrom('game.daily_closes')
    .select('game_day')
    .where('world_id', '=', worldId)
    .orderBy('game_day', 'desc')
    .limit(1)
    .executeTakeFirst();
  const gameDay = gameDayAt(now, clock);
  // Horloge qui recule, heure de clôture ou fuseau modifiés : jamais de clôture antérieure à la dernière.
  if (last && gameDay <= last.game_day) return [];
  const closeAt = dailyCloseAt(gameDay, clock);
  try {
    const outcome = await runDailyClose(db, { worldId, gameDay, closeAt, config, steps, now });
    // Une clôture déjà jouée par un autre moteur n'est pas comptée ici.
    return outcome.status === 'done' ? [gameDay] : [];
  } catch (error) {
    // Monde neuf dont la configuration n'était pas encore en vigueur à la clôture du jour en cours
    // (premier démarrage) : il commence à la clôture suivante.
    if (!last && error instanceof ConfigError) return [];
    throw error;
  }
}

/** Joue la clôture échue de tous les mondes (`played` : le jour de jeu clos), comme `advanceAllWorlds`. */
export async function closeAllWorlds(
  db: Db,
  { now, ...rest }: Omit<CloseWorldRequest, 'worldId' | 'now'> & { now?: Date },
): Promise<{ worldId: string; played: number[]; error?: string }[]> {
  const request = { ...rest, now: now ?? (await databaseNow(db)) };
  return eachWorld(db, (worldId) => closeWorld(db, { ...request, worldId }));
}

/**
 * Fait avancer tous les mondes ; l'échec d'un monde n'arrête pas les autres. Sans instant fourni (cas
 * du moteur ; les tests en fournissent un), l'instant présent est lu une fois à l'horloge de la base.
 */
export async function advanceAllWorlds(
  db: Db,
  { now, ...rest }: Omit<AdvanceRequest, 'worldId' | 'now'> & { now?: Date },
): Promise<{ worldId: string; played: number[]; error?: string }[]> {
  const request = { ...rest, now: now ?? (await databaseNow(db)) };
  return eachWorld(db, (worldId) => advanceWorld(db, { ...request, worldId }));
}

/** Applique une action à chaque monde ; l'échec d'un monde n'arrête pas les autres et il est rapporté. */
async function eachWorld(db: Db, run: (worldId: string) => Promise<number[]>) {
  const worlds = await db.selectFrom('game.worlds').select('id').orderBy('id').execute();
  const results: { worldId: string; played: number[]; error?: string }[] = [];
  for (const { id: worldId } of worlds) {
    try {
      results.push({ worldId, played: await run(worldId) });
    } catch (error) {
      console.error(`World ${worldId} could not advance`, error);
      results.push({
        worldId,
        played: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
