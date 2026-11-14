import { randomUUID } from 'node:crypto';
import {
  ConfigError,
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyClose, type CloseStep } from './close';
import { advanceWorld, closeAllWorlds, closeWorld } from './scheduler';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const HOUR = 3_600_000;
// Clôture à 04 h 00, heure de Paris, quelle que soit la configuration de la base. Les jours joués sont
// passés ; la configuration, elle, est rendue en vigueur à tout instant (base neuve : à peine activée).
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
let config: { at: () => Promise<Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>> };
let byId: ReturnType<typeof createConfigLoader>['byId'];
const withTick = (tickMinutes: number) => ({
  at: async () => {
    const loaded = await config.at();
    return { ...loaded, config: { ...loaded.config, clock: { ...clock, tickMinutes } } };
  },
});
/** Premier jour de jeu de l'essai : il y a trente jours, loin de la clôture du jour. */
const D = gameDayAt(new Date(), clock) - 30;
/** Un instant du jour de jeu `day`, quelques heures après sa clôture. */
const during = (day: number, hours = 5) =>
  new Date(dailyCloseAt(day, clock).getTime() + hours * HOUR);

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  const loaded = await createConfigLoader(db).at(new Date());
  config = { at: async () => ({ ...loaded, config: { ...loaded.config, clock } }) };
  byId = createConfigLoader(db).byId;
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

async function newWorld(): Promise<string> {
  const id = randomUUID();
  await sql`insert into game.worlds (id, slug, name) values (${id}, ${`c-${id.slice(0, 12)}`}, 'Test')`.execute(
    owner,
  );
  return id;
}
/** Étape témoin : un événement par clôture réellement appliquée. */
const probe: CloseStep = {
  name: 'probe',
  async run({ trx, worldId, gameDay }) {
    await sql`insert into game.domain_events (type, payload) values ('CloseProbe', ${JSON.stringify({ worldId, gameDay })}::jsonb)`.execute(
      trx,
    );
    return { gameDay };
  },
};
const effectsOf = async (worldId: string) =>
  (
    await sql<{ day: number }>`select (payload->>'gameDay')::int as day from game.domain_events
      where type = 'CloseProbe' and payload->>'worldId' = ${worldId} order by seq`.execute(db)
  ).rows.map((row) => row.day);
const closesOf = (worldId: string) =>
  db
    .selectFrom('game.daily_closes')
    .select(['game_day', 'close_at', 'summary'])
    .where('world_id', '=', worldId)
    .orderBy('game_day')
    .execute();

describe('clôtures quotidiennes d’un monde', () => {
  it('une clôture manquée est rattrapée une seule fois, même après plusieurs jours de panne', async () => {
    const worldId = await newWorld();
    const close = (now: Date) => closeWorld(db, { worldId, now, config, steps: [probe] });
    // Moteur arrêté à l'heure de la clôture, relancé cinq heures après : la clôture du jour est jouée.
    expect(await close(during(D))).toEqual([D]);
    // Les passages suivants du même jour de jeu ne la rejouent pas, jusqu'à la dernière milliseconde.
    expect(await close(during(D, 6))).toEqual([]);
    expect(await close(new Date(dailyCloseAt(D + 1, clock).getTime() - 1))).toEqual([]);
    // À l'heure dite, la suivante.
    expect(await close(dailyCloseAt(D + 1, clock))).toEqual([D + 1]);
    // Trois jours de panne : une seule clôture, celle du jour en cours ; les jours manqués n'en ont pas.
    expect(await close(during(D + 4))).toEqual([D + 4]);
    expect(await close(during(D + 4, 12))).toEqual([]);
    // Une horloge qui recule ne rejoue rien et ne comble pas les jours manqués.
    expect(await close(during(D + 3))).toEqual([]);
    expect(await effectsOf(worldId)).toEqual([D, D + 1, D + 4]);
    const rows = await closesOf(worldId);
    expect(rows.map((row) => [row.game_day, row.close_at])).toEqual(
      [0, 1, 4].map((offset) => [D + offset, dailyCloseAt(D + offset, clock)]),
    );
    expect(rows[0]?.summary).toEqual({ probe: { gameDay: D } });
  });

  it('deux moteurs concurrents (ici trois) : la clôture une seule fois, pour un seul d’entre eux', async () => {
    const worldId = await newWorld();
    const close = (day: number) =>
      closeWorld(db, { worldId, now: during(day), config, steps: [probe] });
    // Clôture du jour, puis clôture manquée rattrapée : trois moteurs réellement simultanés à chaque fois.
    for (const day of [D, D + 2]) {
      const engines = await Promise.all([close(day), close(day), close(day)]);
      expect(engines.flat()).toEqual([day]);
    }
    // L'effet de chaque clôture n'existe qu'une fois.
    expect(await effectsOf(worldId)).toEqual([D, D + 2]);
    expect((await closesOf(worldId)).map((row) => row.game_day)).toEqual([D, D + 2]);
  });

  it('changer la durée du tick ne décale, ne double ni ne saute aucune clôture', async () => {
    const worldId = await newWorld();
    const close = (now: Date, tickMinutes: number) =>
      closeWorld(db, { worldId, now, config: withTick(tickMinutes), steps: [probe] });
    expect(await close(during(D), 10)).toEqual([D]);
    // Le même jour de jeu, relu avec des ticks de 30 puis de 5 minutes : déjà clos.
    expect(await close(during(D, 6), 30)).toEqual([]);
    expect(await close(during(D, 7), 5)).toEqual([]);
    expect(await close(during(D + 1), 30)).toEqual([D + 1]);
    expect(await close(during(D + 2), 5)).toEqual([D + 2]);
    // Les ticks, eux, changent d'échelle avec leur durée : passé de 10 à 20 minutes, le monde est
    // « derrière » son dernier tick et n'en joue plus. La clôture n'en dépend pas et a lieu quand même.
    const ticks = (now: Date, tickMinutes: number) =>
      advanceWorld(db, { worldId, now, steps: [], config: { ...withTick(tickMinutes), byId } });
    expect(await ticks(during(D + 2), 10)).toHaveLength(1);
    expect(await ticks(during(D + 3), 20)).toEqual([]);
    expect(await close(during(D + 3), 20)).toEqual([D + 3]);
    // Même une durée que la configuration refuserait (7 minutes) ne déplace rien.
    expect(await close(during(D + 3, 8), 7)).toEqual([]);
    expect((await closesOf(worldId)).map((row) => row.close_at)).toEqual(
      [0, 1, 2, 3].map((offset) => dailyCloseAt(D + offset, clock)),
    );
  });

  it('une clôture en échec n’a rien écrit et est reprise ; elle ne se joue pas avant son heure', async () => {
    const [worldId, other] = [await newWorld(), await newWorld()];
    let failures = 1;
    const flaky: CloseStep = {
      name: 'flaky',
      async run(context) {
        if (context.worldId === worldId && failures-- > 0) throw new Error('panne simulée');
        return {};
      },
    };
    const results = await closeAllWorlds(db, { now: during(D), config, steps: [probe, flaky] });
    const byWorld = new Map(results.map((result) => [result.worldId, result]));
    expect(byWorld.get(worldId)).toEqual({ worldId, played: [], error: 'panne simulée' });
    expect(byWorld.get(other)).toEqual({ worldId: other, played: [D] });
    expect([await effectsOf(worldId), await closesOf(worldId)]).toEqual([[], []]);
    const retry = await closeWorld(db, { worldId, now: during(D), config, steps: [probe, flaky] });
    expect(retry).toEqual([D]);
    expect(await effectsOf(worldId)).toEqual([D]);
    const closeAt = dailyCloseAt(D + 1, clock);
    const early = { worldId, gameDay: D + 1, closeAt, config, steps: [] };
    await expect(
      runDailyClose(db, { ...early, now: new Date(closeAt.getTime() - 1) }),
    ).rejects.toThrow('is not due before');
  });

  it('jamais en arrière, même pour un moteur en retard : après la clôture de D + 1, celle de D n’est plus jouée', async () => {
    const worldId = await newWorld();
    const run = (gameDay: number, steps = [probe]) =>
      runDailyClose(db, {
        worldId,
        gameDay,
        closeAt: dailyCloseAt(gameDay, clock),
        config,
        steps,
        now: during(D + 1),
      });
    expect((await run(D + 1)).status).toBe('done');
    // Le moteur en retard avait lu « rien de clos » avant que l'autre ne joue D + 1 : sous verrou, il le voit.
    expect(await run(D)).toEqual({ status: 'skipped', summary: {} });
    expect(await run(D + 1)).toEqual({ status: 'skipped', summary: { probe: { gameDay: D + 1 } } });
    expect([await effectsOf(worldId), (await closesOf(worldId)).length]).toEqual([[D + 1], 1]);
    await expect(run(D + 1, [probe, probe])).rejects.toThrow('Duplicate close step name');
    // Instant de clôture écrit à la main : le jour de jeu 20 000 est le 4 octobre 2024, 04 h 00 d'été à Paris.
    const fixed = await newWorld();
    const now = new Date('2024-10-04T10:00:00Z');
    expect(await closeWorld(db, { worldId: fixed, now, config, steps: [] })).toEqual([20_000]);
    expect((await closesOf(fixed))[0]?.close_at.toISOString()).toBe('2024-10-04T02:00:00.000Z');
  });

  it('monde neuf sans configuration en vigueur à la clôture du jour : commence à la suivante', async () => {
    const worldId = await newWorld();
    const today = dailyCloseAt(D, clock).getTime();
    const young = {
      at: async (instant: Date) =>
        instant.getTime() > today ? config.at() : Promise.reject(new ConfigError('none yet')),
    };
    const start = (now: Date) => closeWorld(db, { worldId, now, config: young, steps: [probe] });
    expect(await start(during(D))).toEqual([]);
    expect(await start(during(D + 1))).toEqual([D + 1]);
  });
});
