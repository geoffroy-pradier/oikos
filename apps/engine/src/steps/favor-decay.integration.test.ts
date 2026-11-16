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
import { runDailyClose } from '../close';
import { favorDecay } from './favor-decay';

// Déclin de la Charis à la clôture (#265), contre Supabase local. Chaque test a son monde ; la configuration
// initiale fait décliner chaque dieu de 100 points de base par jour.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const withGods = (gods: GameConfig['gods'] = initial.gods) => ({
  at: async () => ({ ...loaded, config: { ...initial, clock, gods } }),
});
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, day: number, config = withGods()) =>
  runDailyClose(db, {
    worldId,
    gameDay: day,
    closeAt: dailyCloseAt(day, clock),
    config,
    steps: [favorDecay],
    now: new Date(),
  });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Un monde, sa cité et une maison par Charis donnée, `{ demeter: 1000 }` par exemple. Chaque Charis vient
 * d'une offrande d'un blé, posée par le propriétaire en respectant les gardes de la base.
 */
async function newWorld(...houses: Record<string, number>[]) {
  const [worldId, cityId] = [randomUUID(), randomUUID()];
  await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`f-${worldId.slice(0, 12)}`}, 'Test'))
    insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Agora')`.execute(
    owner,
  );
  const houseIds: string[] = [];
  for (const favors of houses) {
    const [userId, houseId] = [randomUUID(), randomUUID()];
    houseIds.push(houseId);
    await owner.transaction().execute(async (trx) => {
      await sql`with player as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})),
        house as (insert into game.houses (id, world_id, user_id, name, blazon)
          values (${houseId}, ${worldId}, ${userId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}'))
        insert into game.citizenships (house_id, city_id) values (${houseId}, ${cityId})`.execute(
        trx,
      );
      const { rows } = await sql<{
        id: string;
      }>`insert into game.inventories (world_id, house_id, city_id, good_id)
        values (${worldId}, ${houseId}, ${cityId}, 'wheat') returning id`.execute(trx);
      await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
        values (${worldId}, 'wheat', 100, 'production', ${rows[0]?.id}, 'test')`.execute(trx);
      for (const [godId, charis] of Object.entries(favors)) {
        const offering = await sql<{ id: string }>`insert into game.offerings
          (world_id, house_id, city_id, god_id, oboles, charis) values (${worldId}, ${houseId}, ${cityId}, ${godId}, 0, ${charis})
          returning id`.execute(trx);
        const offeringId = offering.rows[0]?.id;
        await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_inventory_id, to_system, kind, offering_id)
          values (${worldId}, 'wheat', 1, ${rows[0]?.id}, 'offering', 'temple.offering', ${offeringId})`.execute(
          trx,
        );
        await sql`insert into game.favor_ledger (world_id, house_id, god_id, amount, kind, offering_id)
          values (${worldId}, ${houseId}, ${godId}, ${charis}, 'offering', ${offeringId})`.execute(
          trx,
        );
      }
    });
  }
  return { worldId, houseIds };
}
/** Charis de chaque maison du monde, par dieu, et lignes de déclin du jour, dans l'ordre des maisons. */
const charisOf = async (worldId: string) =>
  (
    await sql<{ house_id: string; god_id: string; charis: string }>`select house_id, god_id, charis
      from game.favor where world_id = ${worldId} order by house_id, god_id`.execute(db)
  ).rows.map((row) => `${row.god_id}:${row.charis}`);
const decaysOf = async (worldId: string) =>
  (
    await sql<{ amount: string; game_day: number }>`select amount, game_day from game.favor_ledger
      where world_id = ${worldId} and kind = 'decay' order by game_day, amount`.execute(db)
  ).rows.map((row) => `${row.game_day}:${row.amount}`);

describe('déclin de la Charis à la clôture (#265)', () => {
  it('chaque Charis perd 1 % arrondi vers zéro, une fois par jour ; une clôture rejouée ne fait rien', async () => {
    // 1 000 envers Déméter, 99 envers Apollon (trop peu pour perdre une unité), 250 envers Poséidon.
    const { worldId } = await newWorld({ demeter: 1_000, apollo: 99 }, { poseidon: 250 });
    const other = await newWorld({ demeter: 1_000 });
    const first = await close(worldId, TODAY - 1);
    expect(first).toMatchObject({
      status: 'done',
      summary: { favorDecay: { decayed: 2, charisLost: 12 } },
    });
    expect(await charisOf(worldId)).toEqual(
      expect.arrayContaining(['demeter:990', 'apollo:99', 'poseidon:248']),
    );
    expect(await decaysOf(worldId)).toEqual([`${TODAY - 1}:-10`, `${TODAY - 1}:-2`]);
    // Rejouée : la clôture du jour est déjà enregistrée, rien ne décline une seconde fois.
    expect((await close(worldId, TODAY - 1)).status).toBe('skipped');
    expect(await decaysOf(worldId)).toHaveLength(2);
    // Le lendemain, sur ce qu'il reste : 990 perd 9 (9,9 arrondi vers zéro), 248 perd 2.
    expect((await close(worldId, TODAY)).summary).toEqual({
      favorDecay: { decayed: 2, charisLost: 11 },
    });
    expect(await charisOf(worldId)).toEqual(
      expect.arrayContaining(['demeter:981', 'poseidon:246']),
    );
    // L'autre monde n'a pas été touché.
    expect(await charisOf(other.worldId)).toEqual(['demeter:1000']);
  });

  it('un dieu sans déclin, ou retiré de la configuration, ne fait rien perdre', async () => {
    const { worldId } = await newWorld({ demeter: 5_000, athena: 5_000 });
    const gods = initial.gods
      .filter((god) => god.id !== 'athena')
      .map((god) => (god.id === 'demeter' ? { ...god, dailyDecayBps: 0 } : god));
    expect((await close(worldId, TODAY - 1, withGods(gods))).summary).toEqual({
      favorDecay: { decayed: 0, charisLost: 0 },
    });
    expect(await charisOf(worldId)).toEqual(
      expect.arrayContaining(['athena:5000', 'demeter:5000']),
    );
    // Une version publiée avant la Charis : aucun dieu ne décline.
    expect((await close(worldId, TODAY, withGods([]))).summary).toEqual({
      favorDecay: { decayed: 0, charisLost: 0 },
    });
    expect(await decaysOf(worldId)).toEqual([]);
  });

  it('la base refuse un second déclin le même jour, même dans la transaction de la clôture', async () => {
    const { worldId } = await newWorld({ demeter: 1_000 });
    const twice = runDailyClose(db, {
      worldId,
      gameDay: TODAY,
      closeAt: dailyCloseAt(TODAY, clock),
      config: withGods(),
      steps: [favorDecay, { ...favorDecay, name: 'favorDecayAgain' }],
      now: new Date(),
    });
    await expect(twice).rejects.toThrow(/favorDecayAgain.*favor_ledger_decay_once/);
    expect(await charisOf(worldId)).toEqual(['demeter:1000']);
  });
});
