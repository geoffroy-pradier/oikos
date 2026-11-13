import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb } from '@oikos/db';
import { tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dryRunTick, runTick, type TickRequest } from '../tick';
import { npcDemand } from './npc-demand';

// Tests d'intégration de la demande des PNJ contre Supabase local. Chaque test a son monde, sa cité
// `kalliste` et son robinet : les carnets et les soldes ne se mélangent pas.
const db = createDb(
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
);
const loader = createConfigLoader(db);
let active: LoadedConfig;
let index: number;

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  active = await loader.at(new Date());
  index = tickIndexAt(new Date(), active.config.clock.tickMinutes) + 1;
});
afterAll(() => db.destroy());

/**
 * Une classe de 1 000 habitants qui ne veut que du blé : prix de référence 6, élasticité 0,4, prix de
 * réserve 18. Par défaut, 20 unités demandées par tick au prix de référence et 300 oboles de budget.
 */
const economy = (quantityPerThousand = 20, incomePerThousand = 300): GameConfig => ({
  ...(INITIAL_CONFIG as GameConfig),
  market: { npcMaxPriceFactor: 3 },
  npcClasses: [
    {
      id: 'thetes',
      qualitySensitivity: 0.1,
      incomePerThousand,
      basket: [{ goodId: 'wheat', need: 'vital', quantityPerThousand }],
    },
  ],
  cities: [{ id: 'kalliste', population: { thetes: 1000 } }],
});

const request = (worldId: string, config: GameConfig, tick = index): TickRequest => {
  const scheduledAt = tickStart(tick, active.config.clock.tickMinutes);
  return {
    worldId,
    index: tick,
    scheduledAt,
    config: { at: async () => ({ ...active, config }), byId: loader.byId },
    steps: [npcDemand],
    now: () => new Date(scheduledAt.getTime() + 1000),
  };
};

async function newWorld(slug = 'kalliste', faucet = true) {
  const [worldId, cityId] = [randomUUID(), randomUUID()];
  await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`n-${worldId.slice(0, 12)}`}, 'Test')`.execute(
    db,
  );
  await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, ${slug}, 'Agora')`.execute(
    db,
  );
  if (faucet) {
    await db
      .insertInto('game.accounts')
      .values({
        world_id: worldId,
        kind: 'system',
        system_key: 'faucet_npc_purchases',
        house_id: null,
        allow_negative: true,
      })
      .execute();
  }
  return { worldId, cityId };
}
type World = Awaited<ReturnType<typeof newWorld>>;

/** Une maison avec du blé en stock et des ordres de vente `[quantité, prix]`, déposés dans l'ordre. */
async function newSeller({ worldId, cityId }: World, wheat: number, orders: [number, number][]) {
  const userId = randomUUID();
  await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`.execute(
    db,
  );
  const house = await db
    .insertInto('game.houses')
    .values({
      world_id: worldId,
      user_id: userId,
      name: `Vendeur ${[...userId.replace(/[^a-f]/g, '')].slice(0, 10).join('')}`,
      blazon: JSON.stringify({ shape: 'hoplon', tincture: 'aegean', emblem: 'owl' }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('game.accounts')
    .values({ world_id: worldId, kind: 'house', house_id: house.id, system_key: null })
    .execute();
  const inventory = await db
    .insertInto('game.inventories')
    .values({ world_id: worldId, house_id: house.id, city_id: cityId, good_id: 'wheat' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('game.stock_ledger')
    .values({
      world_id: worldId,
      good_id: 'wheat',
      quantity: wheat,
      from_system: 'production',
      to_inventory_id: inventory.id,
      kind: 'test.seed',
    })
    .execute();
  const orderIds: string[] = [];
  for (const [quantity, price] of orders) {
    const order = await db
      .insertInto('game.orders')
      .values({
        world_id: worldId,
        house_id: house.id,
        city_id: cityId,
        good_id: 'wheat',
        side: 'sell',
        price,
        quantity,
        remaining: quantity,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    orderIds.push(order.id);
  }
  return { houseId: house.id, orderIds };
}

const balanceOf = async (houseId: string) =>
  Number(
    (
      await db
        .selectFrom('game.accounts')
        .select('balance')
        .where('house_id', '=', houseId)
        .executeTakeFirstOrThrow()
    ).balance,
  );
const faucetOf = async (worldId: string) =>
  Number(
    (
      await db
        .selectFrom('game.accounts')
        .select('balance')
        .where('world_id', '=', worldId)
        .where('system_key', '=', 'faucet_npc_purchases')
        .executeTakeFirstOrThrow()
    ).balance,
  );
const stockOf = async (houseId: string) => {
  const row = await db
    .selectFrom('game.inventories')
    .select(['quantity', 'reserved'])
    .where('house_id', '=', houseId)
    .executeTakeFirstOrThrow();
  return { quantity: Number(row.quantity), reserved: Number(row.reserved) };
};
const ordersOf = async (worldId: string) =>
  (
    await db
      .selectFrom('game.orders')
      .select(['remaining', 'status'])
      .where('world_id', '=', worldId)
      .orderBy('seq')
      .execute()
  ).map((order) => [Number(order.remaining), order.status]);
const tradesOf = (worldId: string) =>
  db
    .selectFrom('game.trades')
    .select(['sell_order_id', 'buy_order_id', 'price', 'quantity', 'ledger_entry_id'])
    .where('world_id', '=', worldId)
    .orderBy('id')
    .execute();
const carryOf = async (cityId: string) =>
  (
    await db
      .selectFrom('game.npc_demand_carry')
      .select('carry')
      .where('city_id', '=', cityId)
      .executeTakeFirst()
  )?.carry;

describe('demande des PNJ au tick', () => {
  it('achète de la moins chère à la plus chère, dans la limite de la demande à chaque prix', async () => {
    const world = await newWorld();
    // Demande : 21,5 unités à 5 oboles, 20 à 6, 18,8 à 7.
    const dear = await newSeller(world, 30, [
      [10, 7],
      [10, 6],
    ]);
    const cheap = await newSeller(world, 8, [[8, 5]]);

    const outcome = await runTick(db, request(world.worldId, economy()));
    expect(outcome.summary).toEqual({
      npcDemand: {
        units: 18,
        spent: 100,
        markets: [{ city: 'kalliste', goodId: 'wheat', units: 18, spent: 100 }],
      },
    });
    // 8 unités à 5, puis 10 à 6 ; à 7 oboles, les 18 unités voulues sont déjà achetées.
    expect(await ordersOf(world.worldId)).toEqual([
      [10, 'open'],
      [0, 'filled'],
      [0, 'filled'],
    ]);
    expect(await balanceOf(cheap.houseId)).toBe(40);
    expect(await balanceOf(dear.houseId)).toBe(60);
    // La monnaie vient du robinet, et de lui seul.
    expect(await faucetOf(world.worldId)).toBe(-100);
    // Le blé vendu est consommé ; le reste de l'ordre ouvert reste réservé.
    expect(await stockOf(cheap.houseId)).toEqual({ quantity: 0, reserved: 0 });
    expect(await stockOf(dear.houseId)).toEqual({ quantity: 20, reserved: 10 });

    const trades = await tradesOf(world.worldId);
    expect(
      trades.map((trade) => [trade.sell_order_id, Number(trade.price), Number(trade.quantity)]),
    ).toEqual([
      [cheap.orderIds[0], 5, 8],
      [dear.orderIds[1], 6, 10],
    ]);
    expect(trades.every((trade) => trade.buy_order_id === null)).toBe(true);
    const moves = await db
      .selectFrom('game.stock_ledger')
      .select(['to_system', 'quantity', 'ledger_entry_id'])
      .where('world_id', '=', world.worldId)
      .where('kind', '=', 'npc.purchase')
      .orderBy('id')
      .execute();
    expect(
      moves.map((move) => [move.to_system, Number(move.quantity), move.ledger_entry_id]),
    ).toEqual(
      trades.map((trade) => ['npc_consumption', Number(trade.quantity), trade.ledger_entry_id]),
    );
    // La fraction non servie au dernier prix examiné (18,8 à 7 oboles) est reportée.
    expect(await carryOf(world.cityId)).toBeCloseTo(20 * (7 / 6) ** -0.4 - 18, 9);
  });

  it('ne dépense jamais plus que le budget du tick', async () => {
    const world = await newWorld();
    const seller = await newSeller(world, 100, [[100, 6]]);
    // 20 unités demandées, mais 50 oboles de revenu : 8 unités à 6 oboles.
    const outcome = await runTick(db, request(world.worldId, economy(20, 50)));
    expect(outcome.summary).toMatchObject({ npcDemand: { units: 8, spent: 48 } });
    expect(await balanceOf(seller.houseId)).toBe(48);
    expect(await faucetOf(world.worldId)).toBe(-48);
  });

  it('n’achète pas au-delà du prix de réserve', async () => {
    const world = await newWorld();
    const greedy = await newSeller(world, 10, [[10, 19]]);
    expect((await runTick(db, request(world.worldId, economy()))).summary).toEqual({
      npcDemand: { units: 0, spent: 0, markets: [] },
    });
    expect(await balanceOf(greedy.houseId)).toBe(0);
    expect(await carryOf(world.cityId)).toBeUndefined();

    // Au prix de réserve exactement (18 = 3 × 6), ils achètent : 20 × 3^-0,4 = 12,9 unités.
    const fair = await newSeller(world, 20, [[20, 18]]);
    const next = await runTick(db, request(world.worldId, economy(), index + 1));
    expect(next.summary).toMatchObject({ npcDemand: { units: 12, spent: 216 } });
    expect(await balanceOf(fair.houseId)).toBe(216);
    expect(await balanceOf(greedy.houseId)).toBe(0);
  });

  it('reporte la fraction d’unité d’un tick au suivant', async () => {
    const world = await newWorld();
    const seller = await newSeller(world, 50, [[50, 6]]);
    // 2,5 unités par tick au prix de référence : 2, puis 3.
    const config = economy(2.5);
    const first = await runTick(db, request(world.worldId, config));
    expect(first.summary).toMatchObject({ npcDemand: { units: 2 } });
    expect(await carryOf(world.cityId)).toBeCloseTo(0.5, 9);
    const second = await runTick(db, request(world.worldId, config, index + 1));
    expect(second.summary).toMatchObject({ npcDemand: { units: 3 } });
    expect(await carryOf(world.cityId)).toBeCloseTo(0, 9);
    expect(await balanceOf(seller.houseId)).toBe(30);
  });

  it('un tick rejoué n’achète pas deux fois ; un essai à blanc ne laisse rien', async () => {
    const world = await newWorld();
    const seller = await newSeller(world, 50, [[50, 6]]);
    const tick = request(world.worldId, economy());
    const dry = await dryRunTick(db, tick, { seed: 'graine-de-test-pnj-0001' });
    expect(dry).toMatchObject({ npcDemand: { units: 20, spent: 120 } });
    expect(await balanceOf(seller.houseId)).toBe(0);
    expect(await tradesOf(world.worldId)).toEqual([]);

    expect((await runTick(db, tick)).status).toBe('done');
    expect((await runTick(db, tick)).status).toBe('skipped');
    expect(await balanceOf(seller.houseId)).toBe(120);
    expect(await stockOf(seller.houseId)).toEqual({ quantity: 30, reserved: 30 });
  });

  it('ignore une cité absente de la configuration', async () => {
    const world = await newWorld('ailleurs');
    const seller = await newSeller(world, 50, [[50, 6]]);
    expect((await runTick(db, request(world.worldId, economy()))).summary).toEqual({
      npcDemand: { units: 0, spent: 0, markets: [] },
    });
    expect(await balanceOf(seller.houseId)).toBe(0);
  });

  it('sans robinet, le tick échoue et n’écrit rien', async () => {
    const world = await newWorld('kalliste', false);
    const seller = await newSeller(world, 50, [[50, 6]]);
    await expect(runTick(db, request(world.worldId, economy()))).rejects.toThrow(
      /no faucet_npc_purchases account/,
    );
    expect(await balanceOf(seller.houseId)).toBe(0);
    expect(await ordersOf(world.worldId)).toEqual([[50, 'open']]);
    expect(await tradesOf(world.worldId)).toEqual([]);
  });
});
