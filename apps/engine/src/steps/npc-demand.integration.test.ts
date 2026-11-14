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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dryRunTick, runTick, type TickRequest } from '../tick';
import { npcDemand } from './npc-demand';

// Tests d'intégration de la demande des PNJ contre Supabase local. Chaque test a son monde, sa cité
// `kalliste` et son robinet : les carnets et les soldes ne se mélangent pas.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
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

// Le robinet des achats de PNJ naît avec le monde, comme tous les comptes système.
async function newWorld(slug = 'kalliste') {
  const [worldId, cityId] = [randomUUID(), randomUUID()];
  await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`n-${worldId.slice(0, 12)}`}, 'Test')`.execute(
    owner,
  );
  await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, ${slug}, 'Agora')`.execute(
    owner,
  );
  return { worldId, cityId };
}
type World = Awaited<ReturnType<typeof newWorld>>;

/** Une maison avec du blé en stock et des ordres de vente `[quantité, prix]`, déposés dans l'ordre. */
async function newSeller({ worldId, cityId }: World, wheat: number, orders: [number, number][]) {
  const userId = randomUUID();
  await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`.execute(
    owner,
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
  const orderIds = await offer({ worldId, cityId, houseId: house.id }, 'wheat', wheat, orders);
  return { houseId: house.id, orderIds };
}

/** Donne à une maison un stock d'un bien dans une cité, et y dépose ses ordres de vente `[quantité, prix]`. */
async function offer(
  { worldId, cityId, houseId }: { worldId: string; cityId: string; houseId: string },
  goodId: string,
  stock: number,
  orders: [number, number][],
) {
  const inventory = await db
    .insertInto('game.inventories')
    .values({ world_id: worldId, house_id: houseId, city_id: cityId, good_id: goodId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('game.stock_ledger')
    .values({
      world_id: worldId,
      good_id: goodId,
      quantity: stock,
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
    orderIds.push(order.id);
  }
  return orderIds;
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
    .where('good_id', '=', 'wheat')
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

  it('deux cités, deux biens : chaque marché est servi à part, dans l’ordre d’ancienneté à prix égal', async () => {
    // Blé : 15 unités pour 1 000 habitants, prix de réserve 15 (6 × 2,6). Poisson : 5 unités, réserve 31.
    const config: GameConfig = {
      ...economy(15),
      market: { npcMaxPriceFactor: 2.6 },
      npcClasses: [
        {
          id: 'thetes',
          qualitySensitivity: 0.1,
          incomePerThousand: 300,
          basket: [
            { goodId: 'wheat', need: 'vital', quantityPerThousand: 15 },
            { goodId: 'fish', need: 'vital', quantityPerThousand: 5 },
          ],
        },
      ],
      cities: [
        { id: 'kalliste', population: { thetes: 1000 } },
        { id: 'delos', population: { thetes: 2000 } },
      ],
    };
    const kalliste = await newWorld();
    const delos = { worldId: kalliste.worldId, cityId: randomUUID() };
    await sql`insert into game.cities (id, world_id, slug, name) values (${delos.cityId}, ${delos.worldId}, 'delos', 'Agora')`.execute(
      owner,
    );
    // Kallistè, blé : une vente annulée à 1 obole, deux ventes à 6 (la plus ancienne d'abord), une à 16.
    const first = await newSeller(kalliste, 60, [
      [5, 1],
      [10, 6],
      [10, 16],
    ]);
    await db
      .updateTable('game.orders')
      .set({ status: 'cancelled' })
      .where('id', '=', first.orderIds[0] ?? '')
      .execute();
    const second = await newSeller(kalliste, 10, [[10, 6]]);
    // Kallistè : du poisson au prix de référence, et des olives bradées que personne ne demande.
    const [fish] = await offer({ ...kalliste, houseId: first.houseId }, 'fish', 10, [[10, 12]]);
    await offer({ ...kalliste, houseId: second.houseId }, 'olives', 50, [[50, 1]]);
    // Délos : du blé pour le même vendeur, et du poisson juste au-dessus du prix de réserve (32 > 31,2).
    const [wheatInDelos] = await offer({ ...delos, houseId: second.houseId }, 'wheat', 100, [
      [100, 6],
    ]);
    await offer({ ...delos, houseId: first.houseId }, 'fish', 10, [[10, 32]]);

    const outcome = await runTick(db, request(kalliste.worldId, config));
    expect(outcome.summary).toEqual({
      npcDemand: {
        units: 50,
        spent: 330,
        markets: [
          { city: 'delos', goodId: 'wheat', units: 30, spent: 180 },
          { city: 'kalliste', goodId: 'fish', units: 5, spent: 60 },
          { city: 'kalliste', goodId: 'wheat', units: 15, spent: 90 },
        ],
      },
    });
    // Chaque échange sert le bon ordre, et sort du stock de son vendeur, dans sa cité et pour son bien.
    const settled = await sql<{ order: string; quantity: string; kind: string; origin: boolean }>`
      select t.sell_order_id as order, t.quantity, e.kind,
             (select i.house_id = o.house_id and i.city_id = o.city_id and i.good_id = o.good_id
                     and s.quantity = t.quantity and s.to_system = 'npc_consumption'
                from game.stock_ledger s join game.inventories i on i.id = s.from_inventory_id
               where s.ledger_entry_id = t.ledger_entry_id) as origin
      from game.trades t
      join game.orders o on o.id = t.sell_order_id
      join game.ledger_entries e on e.id = t.ledger_entry_id
      where t.world_id = ${kalliste.worldId} order by o.seq`.execute(db);
    expect(settled.rows).toEqual([
      { order: first.orderIds[1], quantity: '10', kind: 'npc.purchase', origin: true },
      { order: second.orderIds[0], quantity: '5', kind: 'npc.purchase', origin: true },
      { order: fish, quantity: '5', kind: 'npc.purchase', origin: true },
      { order: wheatInDelos, quantity: '30', kind: 'npc.purchase', origin: true },
    ]);
    expect(await balanceOf(first.houseId)).toBe(60 + 60);
    expect(await balanceOf(second.houseId)).toBe(30 + 180);
    expect(await faucetOf(kalliste.worldId)).toBe(-330);
  });

  it('une demande inférieure à une unité s’accumule jusqu’à l’unité', async () => {
    const world = await newWorld();
    await newSeller(world, 10, [[10, 6]]);
    const bought: number[] = [];
    for (let tick = 0; tick < 5; tick++) {
      const outcome = await runTick(db, request(world.worldId, economy(0.4), index + tick));
      bought.push((outcome.summary['npcDemand'] as { units: number }).units);
    }
    // 0,4 unité par tick : rien, rien, une unité (1,2), rien, une unité (2,0).
    expect(bought).toEqual([0, 0, 1, 0, 1]);
    expect(await carryOf(world.cityId)).toBeCloseTo(0, 9);
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
});
