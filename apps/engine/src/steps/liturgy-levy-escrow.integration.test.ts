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
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runDailyClose } from '../close';
import { liturgyEvasion, liturgyLevy } from './liturgy-settlement';

// Prélèvement d'office et séquestre (#720, relevé par la relecture, #721), contre Supabase local : il ne prend que la
// trésorerie de la maison, jamais la monnaie que ses ordres d'achat ouverts tiennent sous séquestre à l'agora.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
const DUE_DAY = gameDayAt(new Date(), clock) - 5;
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Une maison à sa liturgie échue de `due` oboles, de trésorerie `treasury` et dont un ordre d'achat ouvert tient
 * `escrow` oboles sous séquestre (un blé à `escrow` oboles : la base exige que le séquestre soit celui des ordres).
 */
async function newHouse(treasury: number, escrow: number, due: number) {
  const [worldId, cityId, houseId, user] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await owner.transaction().execute(async (trx) => {
    for (const statement of [
      sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`s-${worldId.slice(0, 12)}`}, 'Test')`,
      sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'c0', 'Cité')`,
      sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`,
      sql`insert into game.houses (id, world_id, user_id, name, blazon) values (${houseId}, ${worldId}, ${user}, 'Maison', '{}')`,
      sql`insert into game.citizenships (house_id, city_id) values (${houseId}, ${cityId})`,
      sql`insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId}), (${worldId}, 'escrow', ${houseId})`,
      // Les ordres de la maison : un achat de blé dont le reste à payer est son séquestre.
      sql`insert into game.orders (world_id, city_id, house_id, good_id, side, price, quantity, remaining)
        values (${worldId}, ${cityId}, ${houseId}, 'wheat', 'buy', ${escrow}, 1, 1)`,
      // Dotation de la trésorerie et du séquestre, par le robinet de départ puis la retenue de l'ordre.
      sql`with e as (insert into game.ledger_entries (world_id, kind, meta)
          values (${worldId}, 'house.starting_grant', jsonb_build_object('houseId', ${houseId}::text)) returning id)
        insert into game.ledger_lines (entry_id, account_id, amount)
        select e.id, a.id, case when a.kind = 'house' then ${treasury + escrow}::bigint else ${-(treasury + escrow)}::bigint end
        from e join game.accounts a on a.world_id = ${worldId}
          and ((a.kind = 'house' and a.house_id = ${houseId}) or a.system_key = 'faucet_starting_grant')`,
      sql`with e as (insert into game.ledger_entries (world_id, kind, meta)
          values (${worldId}, 'market.escrow_hold', '{}') returning id)
        insert into game.ledger_lines (entry_id, account_id, amount)
        select e.id, a.id, case a.kind when 'escrow' then ${escrow}::bigint else ${-escrow}::bigint end
        from e join game.accounts a on a.world_id = ${worldId} and a.house_id = ${houseId} and a.kind in ('house', 'escrow')`,
      sql`set local session_replication_role = replica`,
      sql`insert into game.liturgies (world_id, city_id, house_id, season, genre, due, designated_day, due_day, due_at)
        values (${worldId}, ${cityId}, ${houseId}, 0, 'festival', ${due}, ${DUE_DAY - 3}, ${DUE_DAY},
          ${dailyCloseAt(DUE_DAY, clock)})`,
    ])
      await statement.execute(trx);
  });
  return { worldId, houseId };
}

const close = (worldId: string) =>
  runDailyClose(db, {
    worldId,
    gameDay: DUE_DAY,
    closeAt: dailyCloseAt(DUE_DAY, clock),
    config: { at: async () => ({ ...loaded, config: { ...initial, clock } }) },
    steps: [liturgyEvasion, liturgyLevy],
    now: new Date(),
  });

const holdingsOf = async (houseId: string) => {
  const { rows } = await sql<{
    kind: string;
    balance: string;
  }>`select kind, balance from game.accounts
    where house_id = ${houseId} and kind in ('house', 'escrow') order by kind`.execute(db);
  return Object.fromEntries(rows.map((row) => [row.kind, Number(row.balance)]));
};
const levyOf = async (worldId: string) => {
  const { rows } = await sql<{
    status: string;
    paid: string;
  }>`select status, paid from game.liturgies
    where world_id = ${worldId}`.execute(db);
  return rows.map((row) => [row.status, Number(row.paid)]);
};

it('un prélèvement d’office ne touche pas le séquestre non nul : le dû entier sur la trésorerie, ou ce qu’elle couvre', async () => {
  // Trésorerie de 900 et séquestre de 700 pour 500 dus : 500 pris sur la trésorerie, le séquestre reste à 700.
  const covered = await newHouse(900, 700, 500);
  expect(await holdingsOf(covered.houseId)).toEqual({ house: 900, escrow: 700 });
  expect((await close(covered.worldId)).summary).toMatchObject({
    liturgyLevy: { levied: 1, leviedOboles: 500, partial: 0 },
  });
  expect(await holdingsOf(covered.houseId)).toEqual({ house: 400, escrow: 700 });
  expect(await levyOf(covered.worldId)).toEqual([['levied', 500]]);
  // Trésorerie de 300 : les 300 oboles qu'elle couvre, pas un de plus, alors que le séquestre en tient 700 de plus.
  const short = await newHouse(300, 700, 500);
  expect((await close(short.worldId)).summary).toMatchObject({
    liturgyLevy: { levied: 1, leviedOboles: 300, partial: 1 },
  });
  expect(await holdingsOf(short.houseId)).toEqual({ house: 0, escrow: 700 });
  expect(await levyOf(short.worldId)).toEqual([['levied', 300]]);
  // L'ordre d'achat est resté ouvert, entier.
  const orders = await sql<{
    status: string;
    remaining: string;
  }>`select status, remaining from game.orders
    where house_id = ${short.houseId}`.execute(db);
  expect(orders.rows).toEqual([{ status: 'open', remaining: '1' }]);
});
