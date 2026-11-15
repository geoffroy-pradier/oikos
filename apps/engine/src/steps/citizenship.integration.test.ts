import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorld } from '../scheduler';
import { citizenship } from './citizenship';

// Citoyenneté à la clôture, contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
const archon = { termDays: 28, candidacyDays: 4, votingDays: 3, maxConsecutiveTerms: 2 };
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const withPolitics = (politics: GameConfig['politics']) => ({
  at: async () => ({ ...loaded, config: { ...initial, clock, politics } }),
});
const THREE_DAYS = withPolitics({ meticDays: 3, archon });
/** Jour de jeu en cours : sa clôture est passée. */
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, day = TODAY, config = THREE_DAYS) =>
  closeWorld(db, { worldId, now: dailyCloseAt(day, clock), config, steps: [citizenship] });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Un monde et sa cité. */
async function newWorld() {
  const [worldId, cityId] = [randomUUID(), randomUUID()];
  await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`c-${worldId.slice(0, 12)}`}, 'Test'))
    insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Agora')`.execute(
    owner,
  );
  return { worldId, cityId };
}
/** Une maison métèque de la cité, arrivée à l'instant donné (posée par le propriétaire). */
async function newMetic({ worldId, cityId }: { worldId: string; cityId: string }, since: Date) {
  const [userId, houseId] = [randomUUID(), randomUUID()];
  await sql`with player as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})),
    house as (insert into game.houses (id, world_id, user_id, name, blazon)
      values (${houseId}, ${worldId}, ${userId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}'))
    insert into game.citizenships (house_id, city_id, since) values (${houseId}, ${cityId}, ${since})`.execute(
    owner,
  );
  return houseId;
}
const statusOf = async (houseId: string) =>
  (
    await sql<{
      status: string;
      recent: boolean;
    }>`select status, since > now() - interval '1 minute' as recent from game.citizenships where house_id = ${houseId}`.execute(
      db,
    )
  ).rows[0];
const grantedEvents = async (cityId: string) =>
  (
    await sql<{ payload: { houseId: string; cityId: string; gameDay: number } }>`
      select payload from game.domain_events
      where type = 'CitizenshipGranted' and payload->>'cityId' = ${cityId} order by seq`.execute(db)
  ).rows.map((row) => row.payload);
const ms = (instant: Date, delta: number) => new Date(instant.getTime() + delta);

describe('citoyenneté à la clôture quotidienne', () => {
  it('trois jours de jeu comme métèque : citoyenne à la clôture du quatrième, une seule fois', async () => {
    const world = await newWorld();
    // Fondée le jour TODAY − 3 (juste avant la clôture de TODAY − 2) : métèque les jours TODAY − 3 à
    // TODAY − 1, citoyenne à la clôture de TODAY. Fondée à l'instant même de la clôture de TODAY − 2 :
    // un jour de plus.
    const boundary = dailyCloseAt(TODAY - 2, clock);
    const early = await newMetic(world, ms(boundary, -1));
    const onTime = await newMetic(world, boundary);
    const elsewhere = await newWorld();
    const stranger = await newMetic(elsewhere, ms(boundary, -86_400_000));

    expect(await close(world.worldId, TODAY - 1)).toEqual([TODAY - 1]);
    expect(await statusOf(early)).toEqual({ status: 'metic', recent: false });
    expect(await grantedEvents(world.cityId)).toEqual([]);

    // Trois moteurs à la fois : une seule clôture, une seule promotion.
    const engines = await Promise.all([1, 2, 3].map(() => close(world.worldId)));
    expect(engines.flat()).toEqual([TODAY]);
    expect(await statusOf(early)).toEqual({ status: 'citizen', recent: true });
    expect(await statusOf(onTime)).toEqual({ status: 'metic', recent: false });
    expect(await grantedEvents(world.cityId)).toEqual([
      { houseId: early, cityId: world.cityId, gameDay: TODAY },
    ]);
    const summary = await sql<{ summary: unknown }>`select summary from game.daily_closes
      where world_id = ${world.worldId} and game_day = ${TODAY}`.execute(db);
    expect(summary.rows[0]?.summary).toEqual({ citizenship: { granted: 1 } });
    // La clôture d'un monde ne promeut personne dans un autre.
    expect(await statusOf(stranger)).toEqual({ status: 'metic', recent: false });

    // Rejouée, la clôture du jour n'est pas jouée une seconde fois.
    expect(await close(world.worldId)).toEqual([]);
    expect(await grantedEvents(world.cityId)).toHaveLength(1);
  });

  it('une clôture jouée en retard ne promeut pas une maison arrivée après son instant de jeu', async () => {
    const world = await newWorld();
    // Un jour de métèque : fondée avant la clôture de TODAY, elle serait citoyenne à cette clôture ;
    // fondée maintenant, après elle, elle attend la suivante.
    const before = await newMetic(world, ms(dailyCloseAt(TODAY, clock), -1));
    const now = await newMetic(world, new Date());
    expect(await close(world.worldId, TODAY, withPolitics({ meticDays: 1, archon }))).toEqual([
      TODAY,
    ]);
    expect((await statusOf(before))?.status).toBe('citizen');
    expect((await statusOf(now))?.status).toBe('metic');
  });

  it('une version publiée avant la citoyenneté ne promeut personne', async () => {
    const world = await newWorld();
    const metic = await newMetic(world, ms(dailyCloseAt(TODAY - 30, clock), 0));
    expect(await close(world.worldId, TODAY, withPolitics(undefined))).toEqual([TODAY]);
    expect(await statusOf(metic)).toEqual({ status: 'metic', recent: false });
    expect(await grantedEvents(world.cityId)).toEqual([]);
  });
});
