import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { dryRunTick, runTick } from '../tick';
import { priceCandlesStep } from './price-candles';

// Tests d'intégration des chandeliers contre Supabase local. Chaque test a son monde : l'étape ne lit
// que les échanges du sien. Elle agit sous le rôle de service ; `owner` pose et date les jeux d'essai.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const loader = createConfigLoader(db);
let active: LoadedConfig;
let index: number;

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  active = await loader.at(new Date());
  index = tickIndexAt(new Date(), active.config.clock.tickMinutes) + 1;
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Joue (ou simule, à blanc) le tick suivant du monde avec la seule étape des chandeliers. */
async function tick(worldId: string, candleMinutes: number, dry = false) {
  const scheduledAt = tickStart(index, active.config.clock.tickMinutes);
  const config = { ...(INITIAL_CONFIG as GameConfig), priceHistory: { candleMinutes } };
  const request = {
    worldId,
    index: index++,
    scheduledAt,
    config: { at: async () => ({ ...active, config }), byId: loader.byId },
    steps: [priceCandlesStep],
    now: () => new Date(scheduledAt.getTime() + 1000),
  };
  const summary = dry
    ? await dryRunTick(db, request, { seed: 'ab' })
    : (await runTick(db, request)).summary;
  return summary['priceCandles'];
}

/** Un monde, sa cité, et une maison qui a de quoi vendre. */
async function newMarket() {
  const [worldId, cityId, userId, houseId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  // Un nom de maison ne porte pas de chiffre.
  const name = `Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`;
  await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`c-${worldId.slice(0, 12)}`}, 'Test')`.execute(
    owner,
  );
  await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Agora')`.execute(
    owner,
  );
  await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`.execute(
    owner,
  );
  await sql`insert into game.houses (id, world_id, user_id, name, blazon) values (${houseId}, ${worldId}, ${userId}, ${name}, '{}')`.execute(
    owner,
  );
  await sql`insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId})`.execute(
    owner,
  );
  return { worldId, cityId, houseId };
}
type Market = Awaited<ReturnType<typeof newMarket>>;

/** Échanges `[heure, prix, quantité]` du 10 novembre 2026 (temps universel), exécutés dans l'ordre donné. */
async function trades(market: Market, goodId: string, list: [string, number, number][]) {
  const { worldId, cityId, houseId } = market;
  await owner.transaction().execute(async (trx) => {
    const inventory = sql`(select id from game.inventories where house_id = ${houseId} and good_id = ${goodId})`;
    await sql`insert into game.inventories (world_id, house_id, city_id, good_id) values (${worldId}, ${houseId}, ${cityId}, ${goodId})
      on conflict do nothing`.execute(trx);
    for (const [time, price, quantity] of list) {
      await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
        values (${worldId}, ${goodId}, ${quantity}, 'production', ${inventory}, 'test.seed')`.execute(
        trx,
      );
      const order = await trx
        .insertInto('game.orders')
        .values({
          world_id: worldId,
          house_id: houseId,
          city_id: cityId,
          good_id: goodId,
          side: 'sell',
          price,
          quantity,
          remaining: quantity,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const entry = await trx
        .insertInto('game.ledger_entries')
        .values({ world_id: worldId, kind: 'npc.purchase' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await sql`insert into game.ledger_lines (entry_id, account_id, amount)
        select ${entry.id}, id, case when kind = 'house' then 1 else -1 end * ${price * quantity}::bigint from game.accounts
        where world_id = ${worldId} and (house_id = ${houseId} or system_key = 'faucet_npc_purchases')`.execute(
        trx,
      );
      await trx
        .insertInto('game.trades')
        .values({
          world_id: worldId,
          sell_order_id: order.id,
          buy_order_id: null,
          price,
          quantity,
          ledger_entry_id: entry.id,
          created_at: new Date(`2026-11-10T${time}Z`),
        })
        .execute();
    }
  });
}

/** Chandeliers du monde : `bien durée début ouverture/plus haut/plus bas/clôture volume montant`. */
async function candles(worldId: string) {
  const rows = await db
    .selectFrom('game.price_candles')
    .selectAll()
    .where('world_id', '=', worldId)
    .orderBy('good_id')
    .orderBy('period_seconds')
    .orderBy('period_start')
    .execute();
  return rows.map(
    (c) =>
      `${c.good_id} ${c.period_seconds} ${c.period_start.toISOString().slice(5, 16)} ${c.open}/${c.high}/${c.low}/${c.close} ${c.volume} ${c.turnover}`,
  );
}

it('résume les échanges par cité, bien et heure ; rejouer ne double rien', async () => {
  const market = await newMarket();
  // Deux échanges portent le même instant, comme ceux d'un appariement : l'ordre d'exécution clôt l'heure.
  await trades(market, 'wheat', [
    ['10:05:00', 6, 10],
    ['10:59:59.999', 8, 5],
    ['10:59:59.999', 5, 20],
    ['11:00:00', 7, 1],
  ]);
  await trades(market, 'olives', [['10:30:00', 9, 2]]);
  const expected = [
    'olives 3600 11-10T10:00 9/9/9/9 2 18',
    'wheat 3600 11-10T10:00 6/8/5/5 35 200', // 6×10 + 8×5 + 5×20
    'wheat 3600 11-10T11:00 7/7/7/7 1 7',
  ];

  expect(await tick(market.worldId, 60, true)).toEqual({ periodSeconds: 3600, candles: 3 });
  expect(await candles(market.worldId)).toEqual([]);
  expect(await tick(market.worldId, 60)).toEqual({ periodSeconds: 3600, candles: 3 });
  expect(await candles(market.worldId)).toEqual(expected);
  // Tick suivant, sans échange nouveau : les deux dernières heures sont relues et réécrites à l'identique.
  expect(await tick(market.worldId, 60)).toEqual({ periodSeconds: 3600, candles: 3 });
  expect(await candles(market.worldId)).toEqual(expected);
});

it('prolonge l’heure en cours et rattrape un échange validé tard dans la précédente', async () => {
  const market = await newMarket();
  await trades(market, 'wheat', [
    ['09:10:00', 3, 4],
    ['10:05:00', 6, 10],
    ['11:00:00', 7, 1],
  ]);
  await tick(market.worldId, 60);
  // Validés après le calcul : l'un daté de 10 h 30, l'autre de 11 h 10, un troisième d'une nouvelle heure.
  await trades(market, 'wheat', [
    ['10:30:00', 4, 3],
    ['11:10:00', 9, 1],
    ['13:00:00', 8, 2],
  ]);
  expect(await tick(market.worldId, 60)).toEqual({ periodSeconds: 3600, candles: 3 });
  expect(await candles(market.worldId)).toEqual([
    'wheat 3600 11-10T09:00 3/3/3/3 4 12', // hors de la fenêtre relue : intact
    'wheat 3600 11-10T10:00 6/6/4/4 13 72', // 60 + 4×3
    'wheat 3600 11-10T11:00 7/9/7/9 2 16',
    'wheat 3600 11-10T13:00 8/8/8/8 2 16',
  ]);
});

it('une durée changée ouvre une série reconstruite depuis le premier échange, sans toucher à l’ancienne', async () => {
  const market = await newMarket();
  await trades(market, 'wheat', [
    ['09:10:00', 3, 4],
    ['10:05:00', 6, 10],
    ['13:00:00', 8, 2],
  ]);
  await tick(market.worldId, 60);
  expect(await tick(market.worldId, 1440)).toEqual({ periodSeconds: 86_400, candles: 1 });
  expect(await candles(market.worldId)).toEqual([
    'wheat 3600 11-10T09:00 3/3/3/3 4 12',
    'wheat 3600 11-10T10:00 6/6/6/6 10 60',
    'wheat 3600 11-10T13:00 8/8/8/8 2 16',
    'wheat 86400 11-10T00:00 3/8/3/8 16 88', // 12 + 60 + 16
  ]);
});

it('le service réécrit les valeurs d’un chandelier, mais ne le déplace ni ne le supprime', async () => {
  const market = await newMarket();
  await trades(market, 'wheat', [['10:05:00', 6, 10]]);
  await tick(market.worldId, 60);
  const mine = sql`world_id = ${market.worldId}`;
  for (const statement of [
    sql`update game.price_candles set period_start = period_start + interval '1 hour' where ${mine}`,
    sql`update game.price_candles set good_id = 'olives' where ${mine}`,
    sql`delete from game.price_candles where ${mine}`,
  ])
    await expect(statement.execute(db)).rejects.toMatchObject({ code: '42501' });
  await sql`update game.price_candles set close = 6 where ${mine}`.execute(db);
  expect(await candles(market.worldId)).toEqual(['wheat 3600 11-10T10:00 6/6/6/6 10 60']);
});
