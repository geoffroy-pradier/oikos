import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  validateConfig,
  type GameConfig,
  type LoadedConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt, tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_STEPS } from '../close-steps';
import { advanceWorld, closeWorld } from '../scheduler';
import { dryRunTick, runTick, type TickRequest, type TickStep } from '../tick';
import { npcDemand } from './npc-demand';
import { npcPopulation } from './npc-population';

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
  // Les cas ci-dessous se lisent en montants bruts ; la taxe a son propre test, en fin de fichier.
  marketTax: { rateBps: 0, burnShareBps: 0 },
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
    .select(['id', 'sell_order_id', 'buy_order_id', 'price', 'quantity', 'ledger_entry_id'])
    .where('world_id', '=', worldId)
    .orderBy('id')
    .execute();
/** Charges utiles des événements `TradeExecuted` d'une cité, dans l'ordre d'émission. */
const tradeEventsOf = async (cityId: string) =>
  (
    await db
      .selectFrom('game.domain_events')
      .select(['payload', 'command_id'])
      .where('type', '=', 'TradeExecuted')
      .where(sql<boolean>`payload->>'cityId' = ${cityId}`)
      .orderBy('seq')
      .execute()
  ).map((event) => ({ ...(event.payload as object), commandId: event.command_id }));
const carryOf = async (cityId: string) =>
  (
    await db
      .selectFrom('game.npc_demand_carry')
      .select('carry')
      .where('city_id', '=', cityId)
      .executeTakeFirst()
  )?.carry;
/** Seuil à 90 % et ±10 % par jour, pour que l'effet se lise en unités entières dès la première clôture. */
const populationDynamics = {
  vitalCoverageThresholdBps: 9_000,
  growthBps: 1_000,
  emigrationBps: 1_000,
  minShareBps: 5_000,
  maxShareBps: 20_000,
};
/** Clôture du jour de jeu en cours, déjà échue, et dernier tick de la veille. */
const closeOfToday = (config: GameConfig, steps = [npcPopulation]) => {
  const today = gameDayAt(new Date(), config.clock);
  const closeAt = dailyCloseAt(today, config.clock);
  const loads = { at: async () => ({ ...active, config }), byId: loader.byId };
  return {
    today,
    closeAt,
    loads,
    eve: tickIndexAt(closeAt, config.clock.tickMinutes) - 1,
    play: (worldId: string) => closeWorld(db, { worldId, now: closeAt, config: loads, steps }),
  };
};
/** État de la cité, par classe : habitants, dernière clôture, couverture retenue. */
const populationOf = async (cityId: string) =>
  (
    await db
      .selectFrom('game.npc_population')
      .selectAll()
      .where('city_id', '=', cityId)
      .orderBy('class_id')
      .execute()
  ).map((row) => [row.class_id, row.population, row.closed_day, row.coverage_bps]);
/** Mesure de la cité, jour de jeu après jour de jeu : unités de biens vitaux servies et demandées. */
const measureOf = async (cityId: string) =>
  (
    await db
      .selectFrom('game.npc_vital_coverage')
      .select(['served', 'demanded'])
      .where('city_id', '=', cityId)
      .orderBy('game_day')
      .execute()
  ).map((row) => [row.served, row.demanded]);

/** Une fête appliquée, posée garde levée : réglée au jour de jeu `settledDay`, proposée par la maison donnée. */
async function festival(
  world: World,
  houseId: string,
  params: object,
  settledDay: number,
  cityId = world.cityId,
) {
  const guards = (on: boolean) =>
    ['elections', 'offices', 'decrees'].map(
      (name) => sql`alter table ${sql.table(`game.${name}`)} ${sql.raw(on ? 'enable' : 'disable')}
        trigger ${sql.ref(`${name}_guard`)}`,
    );
  const officeId = randomUUID();
  await owner.transaction().execute(async (trx) => {
    for (const query of [
      ...guards(false),
      sql`with e as (insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at,
          voting_closes_at, term_ends_at, tallied_at)
          values (${world.worldId}, ${world.cityId}, 'archon', now() - interval '9 days', now() - interval '8 days',
            now() - interval '7 days', now() + interval '20 days', now()) returning *)
        insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
        select ${officeId}, world_id, city_id, office, ${houseId}, id, voting_closes_at, term_ends_at from e`,
      sql`insert into game.decrees (world_id, city_id, model, params, office_id, proposed_by, proposed_at,
          voting_closes_at, quorum_bps, status, tallied_at, electorate, votes_for, votes_against, applied_at, settled_day)
        values (${world.worldId}, ${cityId}, 'festival', ${JSON.stringify(params)}::jsonb, ${officeId}, ${houseId},
          now() - interval '3 days', now() - interval '1 day', 0, 'applied', now(), 0, 0, 0, now(), ${settledDay})`,
      ...guards(true),
    ])
      await query.execute(trx);
  });
}

/**
 * Caravanes `[début, fin exclue, bien, ampleur, cité]` (Kallistè par défaut), planifiées comme par la clôture du
 * jour `day`, enregistrée après elles dans la même transaction.
 */
async function planCaravans(
  world: World,
  day: number,
  rows: [number, number, string, number, string?][],
) {
  const clock = active.config.clock;
  await owner.transaction().execute(async (trx) => {
    await trx
      .insertInto('game.world_events')
      .values(
        rows.map(([start, end, goodId, magnitudeBps, cityId = world.cityId]) => ({
          world_id: world.worldId,
          model: 'caravan',
          city_id: cityId,
          other_city_id: null,
          good_id: goodId,
          planned_day: day,
          start_day: start,
          end_day: end,
          starts_at: dailyCloseAt(start, clock),
          ends_at: dailyCloseAt(end, clock),
          magnitude_bps: magnitudeBps,
          seed: '0'.repeat(64),
        })),
      )
      .execute();
    await sql`insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
      values (${world.worldId}, ${day}, now(), ${active.id})`.execute(trx);
  });
}

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
    // Un événement de domaine par achat, dans l'ordre des achats : sans ordre d'achat ni commande.
    const sold = (orderId: string | undefined, price: number, quantity: number) => ({
      tradeId: trades.find((trade) => trade.sell_order_id === orderId)?.id,
      cityId: world.cityId,
      goodId: 'wheat',
      sellOrderId: orderId,
      buyOrderId: null,
      price,
      quantity,
      commandId: null,
    });
    expect(await tradeEventsOf(world.cityId)).toEqual([
      sold(cheap.orderIds[0], 5, 8),
      sold(dear.orderIds[1], 6, 10),
    ]);
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

  it('fête sur deux jours (#263) : demande et budget de ses biens relevés ces jours-là, besoin mesuré inchangé', async () => {
    const world = await newWorld();
    const seller = await newSeller(world, 1_000, [[1_000, 6]]);
    const decrees = (INITIAL_CONFIG as GameConfig).decrees;
    if (!decrees?.models.festival)
      throw new Error('festival expected in the initial configuration');
    // Une fête au maximum (30 000 oboles) sur deux jours : +5 000 ÷ 2 = +25 % chaque jour.
    const rules = {
      ...decrees.models.festival,
      goodIds: ['wheat', 'bread'],
      demandBoostBps: 5_000,
    };
    const config = { ...economy(), decrees: { ...decrees, models: { festival: rules } } };
    const clock = active.config.clock;
    const day = gameDayAt(tickStart(index, clock.tickMinutes), clock);
    const other = randomUUID();
    await sql`insert into game.cities (id, world_id, slug, name) values (${other}, ${world.worldId}, 'elaia', 'E')`.execute(
      owner,
    );
    await festival(
      world,
      seller.houseId,
      { amountOboles: 30_000, days: 2, goodIds: ['wheat'] },
      day,
    );
    // Une fête d'un autre bien, une fête de la même cité déjà finie, une fête d'une autre cité : sans effet.
    await festival(
      world,
      seller.houseId,
      { amountOboles: 30_000, days: 7, goodIds: ['bread'] },
      day,
    );
    await festival(
      world,
      seller.houseId,
      { amountOboles: 30_000, days: 1, goodIds: ['wheat'] },
      day - 1,
    );
    await festival(
      world,
      seller.houseId,
      { amountOboles: 30_000, days: 7, goodIds: ['wheat'] },
      day,
      other,
    );
    const ticks = [
      index,
      ...[1, 2].map(
        (later) => tickIndexAt(dailyCloseAt(day + later, clock), clock.tickMinutes) + 1,
      ),
    ];
    const units = [];
    for (const tick of ticks)
      units.push((await runTick(db, request(world.worldId, config, tick))).summary['npcDemand']);
    expect(units).toMatchObject([{ units: 25 }, { units: 25 }, { units: 20 }]);
    expect(await measureOf(world.cityId)).toEqual([
      [25, 20],
      [25, 20],
      [20, 20],
    ]);
    expect(await balanceOf(seller.houseId)).toBe(70 * 6);
  });

  it('caravane étrangère (#267) : sa hausse s’ajoute à celle d’une fête, pendant ses seuls jours', async () => {
    const world = await newWorld();
    const seller = await newSeller(world, 1_000, [[1_000, 6]]);
    const decrees = (INITIAL_CONFIG as GameConfig).decrees;
    if (!decrees?.models.festival)
      throw new Error('festival expected in the initial configuration');
    const rules = { ...decrees.models.festival, goodIds: ['wheat'], demandBoostBps: 5_000 };
    const config = { ...economy(), decrees: { ...decrees, models: { festival: rules } } };
    const clock = active.config.clock;
    const day = gameDayAt(tickStart(index, clock.tickMinutes), clock);
    // Fête de deux jours à partir du jour du tick : +25 %. Caravane de blé à +50 % les deux jours suivants ;
    // une plus faible (+30 %) le second, qui ne s'y ajoute pas ; une caravane de pain ensuite, sans effet sur le blé.
    await festival(
      world,
      seller.houseId,
      { amountOboles: 30_000, days: 2, goodIds: ['wheat'] },
      day,
    );
    await planCaravans(world, day, [
      [day + 1, day + 3, 'wheat', 5_000],
      [day + 2, day + 3, 'wheat', 3_000],
      [day + 3, day + 4, 'bread', 9_000],
    ]);
    const ticks = [
      index,
      ...[1, 2, 3].map(
        (later) => tickIndexAt(dailyCloseAt(day + later, clock), clock.tickMinutes) + 1,
      ),
    ];
    const units = [];
    for (const tick of ticks)
      units.push((await runTick(db, request(world.worldId, config, tick))).summary['npcDemand']);
    expect(units).toMatchObject([{ units: 25 }, { units: 35 }, { units: 30 }, { units: 20 }]);
    // Le besoin mesuré ne change pas : la caravane achète en plus, elle ne nourrit pas la cité.
    expect(await measureOf(world.cityId)).toEqual([
      [25, 20],
      [35, 20],
      [30, 20],
      [20, 20],
    ]);
    expect(await balanceOf(seller.houseId)).toBe(110 * 6);
  });

  it('caravane (#267) : sans effet sur une autre cité, budget relevé, jusqu’au triple du besoin avec une fête', async () => {
    const world = await newWorld();
    const seller = await newSeller(world, 1_000, [[1_000, 6]]);
    const decrees = (INITIAL_CONFIG as GameConfig).decrees;
    if (!decrees?.models.festival)
      throw new Error('festival expected in the initial configuration');
    const rules = { ...decrees.models.festival, goodIds: ['wheat'], demandBoostBps: 10_000 };
    const clock = active.config.clock;
    const day = gameDayAt(tickStart(index, clock.tickMinutes), clock);
    const elaia = randomUUID();
    await sql`insert into game.cities (id, world_id, slug, name) values (${elaia}, ${world.worldId}, 'elaia', 'E')`.execute(
      owner,
    );
    // Caravanes de blé au plus fort : à Elaia dès le lendemain, à Kallistè le surlendemain ; une fête au
    // maximum d'un seul jour (+100 %) le troisième jour.
    await planCaravans(world, day, [
      [day + 1, day + 4, 'wheat', 10_000, elaia],
      [day + 2, day + 4, 'wheat', 10_000],
    ]);
    await festival(
      world,
      seller.houseId,
      { amountOboles: 30_000, days: 1, goodIds: ['wheat'] },
      day + 3,
    );
    const tick = (later: number) =>
      tickIndexAt(dailyCloseAt(day + later, clock), clock.tickMinutes) + 1;
    const units = [];
    // 50 oboles de revenu : 8 unités à 6 oboles, puis, budget doublé par la caravane de Kallistè, 16.
    for (const later of [1, 2])
      units.push(
        (await runTick(db, request(world.worldId, economy(20, 50), tick(later)))).summary[
          'npcDemand'
        ],
      );
    // Budget large et fête : 20 unités de besoin, +100 % de la fête, +100 % de la caravane.
    const festive = { ...economy(), decrees: { ...decrees, models: { festival: rules } } };
    units.push((await runTick(db, request(world.worldId, festive, tick(3)))).summary['npcDemand']);
    expect(units).toMatchObject([
      { units: 8, spent: 48 },
      { units: 16, spent: 96 },
      { units: 60, spent: 360 },
    ]);
    expect(await measureOf(world.cityId)).toEqual([
      [8, 20],
      [16, 20],
      [60, 20],
    ]);
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
    expect(await tradeEventsOf(world.cityId)).toEqual([]);
    expect([await populationOf(world.cityId), await measureOf(world.cityId)]).toEqual([[], []]);

    expect((await runTick(db, tick)).status).toBe('done');
    expect((await runTick(db, tick)).status).toBe('skipped');
    expect(await tradeEventsOf(world.cityId)).toMatchObject([{ price: 6, quantity: 20 }]);
    expect(await measureOf(world.cityId)).toEqual([[20, 20]]);
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
    expect([await populationOf(world.cityId), await measureOf(world.cityId)]).toEqual([[], []]);
  });

  it('la population naît de la configuration, la clôture la fait évoluer d’après la mesure des ticks, demande et budget la suivent', async () => {
    const [rich, poor] = [economy(), economy(20, 100)].map((config) => ({
      ...config,
      populationDynamics,
    })) as [GameConfig, GameConfig];
    // Deux derniers ticks de la veille : une cité servie en entier (20 unités sur 20 à chaque tick), une
    // cité au marché vide. La mesure du jour cumule les deux ticks.
    const { today, eve } = closeOfToday(rich);
    const [fed, starved] = [await newWorld(), await newWorld()];
    const seller = await newSeller(fed, 100, [[100, 6]]);
    for (const tick of [eve - 1, eve]) {
      await runTick(db, request(fed.worldId, rich, tick));
      await runTick(db, request(starved.worldId, poor, tick));
    }
    expect(await populationOf(fed.cityId)).toEqual([['thetes', 1000, null, null]]);
    expect(await measureOf(fed.cityId)).toEqual([[40, 40]]);
    expect(await populationOf(starved.cityId)).toEqual([['thetes', 1000, null, null]]);
    expect(await measureOf(starved.cityId)).toEqual([[0, 40]]);

    expect(await closeOfToday(rich).play(fed.worldId)).toEqual([today]);
    expect(await closeOfToday(poor).play(starved.worldId)).toEqual([today]);
    expect(await populationOf(fed.cityId)).toEqual([['thetes', 1100, today, 10_000]]);
    expect(await populationOf(starved.cityId)).toEqual([['thetes', 900, today, 0]]);

    // 1 100 habitants : 22 unités demandées, 330 oboles de budget. 900 habitants, 100 oboles de revenu
    // pour mille : 18 unités demandées, mais 90 oboles de budget, soit 15 unités à 6 oboles.
    const late = await newSeller(starved, 100, [[100, 6]]);
    const grown = await runTick(db, request(fed.worldId, rich));
    expect(grown.summary).toMatchObject({ npcDemand: { units: 22, spent: 132 } });
    const shrunk = await runTick(db, request(starved.worldId, poor));
    expect(shrunk.summary).toMatchObject({ npcDemand: { units: 15, spent: 90 } });
    expect(await balanceOf(seller.houseId)).toBe(240 + 132);
    expect(await balanceOf(late.houseId)).toBe(90);
    expect(await faucetOf(starved.worldId)).toBe(-90);
    // La mesure du nouveau jour repart de zéro et suit la population courante, pas celle de la configuration.
    expect((await measureOf(fed.cityId)).at(-1)).toEqual([22, 22]);
    expect((await measureOf(starved.cityId)).at(-1)).toEqual([15, 18]);
  });

  it('panne du moteur : les ticks rattrapés achètent mais ne mesurent rien, la classe ne bouge pas', async () => {
    // 108 oboles de budget : 18 unités sur 20 à chaque tick, soit exactement le seuil de 90 %.
    const config = { ...economy(20, 108), populationDynamics };
    const { today, closeAt, eve, loads, play } = closeOfToday(config);
    const world = await newWorld();
    // Un tick joué à l'heure (18 unités), puis de quoi servir trois ticks de plus, pas davantage.
    const seller = await newSeller(world, 72, [[72, 6]]);
    await runTick(db, request(world.worldId, config, eve - 11));
    // Le moteur s'arrête onze ticks et repart juste après la clôture : il rattrape la veille d'une
    // traite, contre un carnet que personne n'a pu regarnir, puis joue à l'heure le tick en cours.
    const now = new Date(closeAt.getTime() + 1000);
    const played = await advanceWorld(db, {
      worldId: world.worldId,
      now,
      config: loads,
      steps: [npcDemand],
    });
    expect(played).toEqual(Array.from({ length: 12 }, (_, rank) => eve - 10 + rank));
    expect(await balanceOf(seller.houseId)).toBe(72 * 6);
    // La veille n'a qu'une mesure, celle du tick joué à l'heure ; le tick en cours ouvre celle du jour.
    expect(await measureOf(world.cityId)).toEqual([
      [18, 20],
      [0, 20],
    ]);
    expect(await play(world.worldId)).toEqual([today]);
    // 90 % de couverture, pas 30 % (72 unités sur 240) : au seuil, la classe ne bouge pas.
    expect(await populationOf(world.cityId)).toEqual([['thetes', 1000, today, 9_000]]);
  });

  it('une clôture complète jouée pendant un tick : ni attente du tick, ni interblocage', async () => {
    const config = { ...economy(), populationDynamics };
    const { today, eve, play } = closeOfToday(config, [...CLOSE_STEPS]);
    const world = await newWorld();
    await newSeller(world, 100, [[100, 6]]);
    await runTick(db, request(world.worldId, config, eve));
    // Le tick prend le verrou des appariements, puis attend que la clôture soit bloquée dessus (étape
    // d'entretien) : elle a déjà fait croître la population, dont elle tient les lignes.
    let closing: Promise<number[]> | undefined;
    const hold: TickStep = {
      name: 'hold',
      async run({ trx }) {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${world.worldId}`}, 0))`.execute(
          trx,
        );
        closing = play(world.worldId);
        const blocked = sql`select 1 from pg_locks where locktype = 'advisory' and not granted`;
        while ((await blocked.execute(owner)).rows.length === 0)
          await new Promise((resolve) => setTimeout(resolve, 20));
        return {};
      },
    };
    const tick = await runTick(db, { ...request(world.worldId, config), steps: [hold, npcDemand] });
    expect(await closing).toEqual([today]);
    // Le tick a lu, sans attendre, la population d'avant la clôture : 20 unités pour 1 000 habitants.
    expect(tick.summary).toMatchObject({ npcDemand: { units: 20, spent: 120 } });
    expect(await populationOf(world.cityId)).toEqual([['thetes', 1100, today, 10_000]]);
    expect((await measureOf(world.cityId)).at(-1)).toEqual([20, 20]);
  });

  it('taxe de marché : le robinet paie le brut, le vendeur reçoit le net, le reste va au puits et au trésor de la cité', async () => {
    const world = await newWorld();
    // 20 unités demandées, 300 oboles de budget : 10 à 5 (taxe ⌈2,5⌉ = 3, dont 2 détruites), 10 à 6 (3, dont 2).
    const seller = await newSeller(world, 100, [
      [10, 5],
      [10, 6],
    ]);
    const taxed = { ...economy(), marketTax: { rateBps: 500, burnShareBps: 5000 } };
    const outcome = await runTick(db, request(world.worldId, taxed));
    // Le budget des PNJ se compte en brut : la taxe ne leur fait rien acheter de plus ni de moins.
    expect(outcome.summary['npcDemand']).toMatchObject({ units: 20, spent: 110 });
    const lines = await sql<{ lines: string }>`
      select string_agg(coalesce(a.system_key, a.kind) || ':' || l.amount, ' ' order by l.amount, a.kind) as lines
      from game.trades t join game.ledger_lines l on l.entry_id = t.ledger_entry_id
      join game.accounts a on a.id = l.account_id
      where t.world_id = ${world.worldId} group by t.id, t.price order by t.price`.execute(db);
    expect(lines.rows.map((row) => row.lines)).toEqual([
      'faucet_npc_purchases:-50 treasury:1 sink_market_tax:2 house:47',
      'faucet_npc_purchases:-60 treasury:1 sink_market_tax:2 house:57',
    ]);
    expect([await balanceOf(seller.houseId), await faucetOf(world.worldId)]).toEqual([104, -110]);
    // Rien ne se crée au-delà du robinet : tous les soldes du monde s'annulent, et égalent leurs lignes.
    const check = await sql<{ total: string; broken: string }>`
      select sum(a.balance) as total, count(*) filter (where not c.ok) as broken
      from game.accounts a join game.account_balance_check c on c.account_id = a.id
      where a.world_id = ${world.worldId}`.execute(db);
    expect(check.rows).toEqual([{ total: '0', broken: '0' }]);
  });

  it('une écriture ne règle qu’un échange, même pour deux transactions qui valident leurs contrôles en même temps', async () => {
    const world = await newWorld();
    const seller = await newSeller(world, 10, [
      [5, 8],
      [5, 8],
    ]);
    // Une écriture d'achat des PNJ de 40 oboles, validée sans échange (5.3, débits hors échange).
    const accounts = await db
      .selectFrom('game.accounts')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('house_id', '=', seller.houseId),
          eb.and([
            eb('world_id', '=', world.worldId),
            eb('system_key', '=', 'faucet_npc_purchases'),
          ]),
        ]),
      )
      .orderBy('kind')
      .execute();
    const entry = await db.transaction().execute(async (trx) => {
      const posted = await trx
        .insertInto('game.ledger_entries')
        .values({ world_id: world.worldId, kind: 'npc.purchase' })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Trésorerie du vendeur (`house`) créditée, robinet (`system`) débité.
      await trx
        .insertInto('game.ledger_lines')
        .values(
          accounts.map((account, i) => ({
            entry_id: posted.id,
            account_id: account.id,
            amount: i ? -40 : 40,
          })),
        )
        .execute();
      return posted;
    });
    // Deux transactions rattachent chacune un échange de 5 à 8 à cette écriture, sur deux ventes distinctes
    // (aucun verrou d'ordre commun), et forcent leurs contrôles avant de valider : chacune ne voit que le
    // sien. L'index unique fait attendre la seconde, puis la refuse.
    const settle = (trx: typeof db, sellOrderId = '') =>
      trx
        .insertInto('game.trades')
        .values({
          world_id: world.worldId,
          sell_order_id: sellOrderId,
          buy_order_id: null,
          price: 8,
          quantity: 5,
          ledger_entry_id: entry.id,
        })
        .execute()
        .then(() => sql`set constraints all immediate`.execute(trx));
    const first = await db.startTransaction().execute();
    const second = await db.startTransaction().execute();
    await settle(first, seller.orderIds[0]);
    // Le refus est capté dès qu'il arrive : il peut précéder la fin de la validation de la première.
    const racing = settle(second, seller.orderIds[1]).then(
      () => 'accepted',
      (error: unknown) => error,
    );
    await first.commit().execute();
    expect(await racing).toMatchObject({
      code: '23505',
      constraint: 'trades_ledger_entry_unique',
    });
    await second.rollback().execute();
    expect((await tradesOf(world.worldId)).map((trade) => trade.ledger_entry_id)).toEqual([
      entry.id,
    ]);
    expect(await ordersOf(world.worldId)).toEqual([
      [0, 'filled'],
      [5, 'open'],
    ]);
  });

  it('la configuration initiale joue la demande dans chacune des quatre cités (#250)', async () => {
    const validation = validateConfig(INITIAL_CONFIG);
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    const { config } = validation;
    const kalliste = await newWorld();
    const others = ['elaia', 'ampelos', 'halos', 'delos'].map((slug) => ({
      slug,
      worldId: kalliste.worldId,
      cityId: randomUUID(),
    }));
    for (const { slug, worldId, cityId } of others)
      await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, ${slug}, 'Agora')`.execute(
        owner,
      );
    // Le même blé au prix de référence dans chaque cité, y compris Délos, absente de la configuration.
    for (const city of [kalliste, ...others]) await newSeller(city, 100, [[100, 6]]);

    const outcome = await runTick(db, request(kalliste.worldId, config));
    // Même population et même panier partout : la même demande, 30,45 blés au prix de référence.
    const wheat = { goodId: 'wheat', units: 30, spent: 180 };
    expect(outcome.summary).toEqual({
      npcDemand: {
        units: 120,
        spent: 720,
        markets: ['ampelos', 'elaia', 'halos', 'kalliste'].map((city) => ({ city, ...wheat })),
      },
    });
    // Chaque cité de la configuration a ses classes, à leur population initiale, et sa mesure du jour.
    const born = await db
      .selectFrom('game.npc_population as p')
      .innerJoin('game.cities as c', 'c.id', 'p.city_id')
      .select(['c.slug', 'p.class_id', 'p.population'])
      .where('p.world_id', '=', kalliste.worldId)
      .orderBy('c.slug')
      .orderBy('p.class_id')
      .execute();
    const classes = config.npcClasses.map((npcClass) => npcClass.id).sort();
    expect([...new Set(born.map((row) => row.slug))]).toEqual([
      'ampelos',
      'elaia',
      'halos',
      'kalliste',
    ]);
    for (const city of config.cities)
      expect(born.filter((row) => row.slug === city.id)).toEqual(
        classes.map((classId) => ({
          slug: city.id,
          class_id: classId,
          population: city.population[classId],
        })),
      );
    const measured = await db
      .selectFrom('game.npc_vital_coverage')
      .select((eb) => eb.fn.count<string>('city_id').distinct().as('cities'))
      .where('world_id', '=', kalliste.worldId)
      .executeTakeFirstOrThrow();
    expect(Number(measured.cities)).toBe(4);
  });
});
