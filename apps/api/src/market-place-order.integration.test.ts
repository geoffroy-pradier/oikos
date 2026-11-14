import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { npcDemand } from '@oikos/engine';
import { createRng } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Tests d'intégration de `market.placeOrder` contre Supabase local. Le fichier a son propre monde (cités et
// ordres ne se suppriment pas : rien ne doit apparaître dans le monde de test des autres suites), et chaque
// test sa propre cité : les carnets ne se mélangent pas d'un test à l'autre.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const app = createApp({
  db,
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const WORLD = randomUUID();
beforeAll(async () => {
  await sql`insert into game.worlds (id, slug, name) values (${WORLD}, ${`m-${WORLD.slice(0, 12)}`}, 'Marché de test')`.execute(
    owner,
  );
  // Les comptes système (robinets, puits) naissent avec le monde.
});
const GRANT = TEST_CONFIG.config.starting.grantOboles;
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

const send = async (user: string, command: string, body: unknown, key: string = randomUUID()) => {
  const res = await app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { data?: never; error?: never } };
};

async function newCity(slug = `c-${letters()}`): Promise<string> {
  const id = randomUUID();
  await sql`insert into game.cities (id, world_id, slug, name) values (${id}, ${WORLD}, ${slug}, 'Agora de test')`.execute(
    owner,
  );
  return id;
}

/** Fonde une maison dans la cité par la commande réelle, et lui donne du blé par le journal des stocks. */
async function newPlayer(cityId: string, wheat = 0) {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const founded = await send(user, 'house.create', {
    cityId,
    name: `Agora ${letters()}`,
    blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
  });
  const houseId = (founded.body.data as unknown as { houseId: string }).houseId;
  const player = { user, houseId, cityId };
  if (wheat > 0) await give(player, 'wheat', wheat);
  return player;
}
interface Player {
  user: string;
  houseId: string;
  cityId: string;
}
async function give(player: Player, goodId: string, quantity: number) {
  const inventory = await db
    .insertInto('game.inventories')
    .values({ world_id: WORLD, house_id: player.houseId, city_id: player.cityId, good_id: goodId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('game.stock_ledger')
    .values({
      world_id: WORLD,
      good_id: goodId,
      quantity,
      from_system: 'production',
      to_inventory_id: inventory.id,
      kind: 'test.seed',
    })
    .execute();
}

const order = (
  player: Player,
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
  key?: string,
  goodId = 'wheat',
) =>
  send(
    player.user,
    'market.placeOrder',
    { cityId: player.cityId, goodId, side, price, quantity },
    key,
  );
const eventsOf = async (cityId: string, type: string) =>
  (
    await db
      .selectFrom('game.domain_events')
      .select('payload')
      .where(sql<boolean>`payload->>'cityId' = ${cityId}`)
      .where('type', '=', type)
      .orderBy('seq')
      .execute()
  ).map((event) => event.payload as Record<string, unknown>);
/** Trésorerie, puis blé « quantité/réservé ». */
const stateOf = async (player: Player) => {
  const account = await db
    .selectFrom('game.accounts')
    .select('balance')
    .where('house_id', '=', player.houseId)
    .executeTakeFirstOrThrow();
  const stock = await db
    .selectFrom('game.inventories')
    .select(['quantity', 'reserved'])
    .where('house_id', '=', player.houseId)
    .where('good_id', '=', 'wheat')
    .executeTakeFirst();
  return [Number(account.balance), stock ? `${stock.quantity}/${stock.reserved}` : 'aucun'];
};
/** Contrôles de la base : chaque solde et chaque stock égale la somme de son journal. */
const ledgersAreConsistent = async (players: Player[]) => {
  const houses = players.map((player) => player.houseId);
  const broken = await sql<{ n: string }>`
    select (select count(*) from game.account_balance_check c join game.accounts a on a.id = c.account_id
            where a.house_id = any(${houses}::uuid[]) and not c.ok)
         + (select count(*) from game.inventory_quantity_check c join game.inventories i on i.id = c.inventory_id
            where i.house_id = any(${houses}::uuid[]) and not c.ok) as n`.execute(db);
  return Number(broken.rows[0]?.n);
};

describe('market.placeOrder', () => {
  it('une vente attend dans le carnet et réserve son stock ; pas de vente à découvert', async () => {
    const seller = await newPlayer(await newCity(), 100);
    const first = await order(seller, 'sell', 6, 60);
    expect(first).toMatchObject({
      status: 200,
      body: { data: { status: 'open', remaining: 60, trades: [] } },
    });
    expect(await stateOf(seller)).toEqual([GRANT, '100/60']);
    expect(await order(seller, 'sell', 7, 41)).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_STOCK' } },
    });
    const empty = await newPlayer(seller.cityId);
    expect((await order(empty, 'sell', 6, 1)).body).toMatchObject({
      error: { code: 'INSUFFICIENT_STOCK' },
    });
    expect(await stateOf(seller)).toEqual([GRANT, '100/60']);
    // Un événement par ordre accepté, aucun pour les ordres refusés.
    expect(await eventsOf(seller.cityId, 'OrderPlaced')).toEqual([
      {
        orderId: (first.body.data as unknown as { orderId: string }).orderId,
        houseId: seller.houseId,
        cityId: seller.cityId,
        goodId: 'wheat',
        side: 'sell',
        price: 6,
        quantity: 60,
      },
    ]);
  });

  it('un achat sert les ventes de la moins chère à la plus chère, au prix de chacune, et annule son reste', async () => {
    const cityId = await newCity();
    const [cheap, dear, buyer] = [
      await newPlayer(cityId, 50),
      await newPlayer(cityId, 50),
      await newPlayer(cityId),
    ];
    await order(dear, 'sell', 9, 30);
    await order(cheap, 'sell', 6, 20);
    await order(dear, 'sell', 20, 10);
    const bought = await order(buyer, 'buy', 10, 60);
    expect(bought).toMatchObject({
      status: 200,
      body: {
        data: {
          status: 'cancelled',
          remaining: 10,
          trades: [
            { price: 6, quantity: 20 },
            { price: 9, quantity: 30 },
          ],
        },
      },
    });
    const paid = 6 * 20 + 9 * 30;
    expect(await stateOf(buyer)).toEqual([GRANT - paid, '50/0']);
    expect(await stateOf(cheap)).toEqual([GRANT + 120, '30/0']);
    expect(await stateOf(dear)).toEqual([GRANT + 270, '20/10']);
    expect(await ledgersAreConsistent([cheap, dear, buyer])).toBe(0);
    const book = await sql<{ price: string; quantity: string }>`
      select price, quantity from game.order_book() where city_id = ${cityId}`.execute(owner);
    expect(book.rows).toEqual([{ price: '20', quantity: '10' }]);
    const buyOrderId = (bought.body.data as unknown as { orderId: string }).orderId;
    expect(await eventsOf(cityId, 'TradeExecuted')).toMatchObject([
      { buyOrderId, price: 6, quantity: 20 },
      { buyOrderId, price: 9, quantity: 30 },
    ]);
    expect(await eventsOf(cityId, 'OrderPlaced')).toMatchObject([
      { side: 'sell', price: 9 },
      { side: 'sell', price: 6 },
      { side: 'sell', price: 20 },
      { orderId: buyOrderId, houseId: buyer.houseId, side: 'buy', price: 10, quantity: 60 },
    ]);
    // Chaque échange est payé par une écriture `market.trade`, et livré par un mouvement qui la porte.
    const settled = await sql<{ quantity: string; moved: string; kind: string }>`
      select t.quantity, e.kind,
             (select string_agg(s.quantity::text, ',') from game.stock_ledger s
               where s.ledger_entry_id = t.ledger_entry_id) as moved
      from game.trades t join game.ledger_entries e on e.id = t.ledger_entry_id
      where t.buy_order_id = ${buyOrderId} order by t.price`.execute(db);
    expect(settled.rows).toEqual([
      { quantity: '20', moved: '20', kind: 'market.trade' },
      { quantity: '30', moved: '30', kind: 'market.trade' },
    ]);
  });

  it('achat sans contrepartie ou au-dessus de ses moyens : rien ne bouge', async () => {
    const cityId = await newCity();
    const [seller, buyer] = [await newPlayer(cityId, 10), await newPlayer(cityId)];
    expect((await order(buyer, 'buy', 5, 3)).body).toMatchObject({
      data: { status: 'cancelled', remaining: 3, trades: [] },
    });
    await order(seller, 'sell', GRANT, 2);
    expect(await order(buyer, 'buy', GRANT, 2)).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_FUNDS' } },
    });
    expect([await stateOf(seller), await stateOf(buyer)]).toEqual([
      [GRANT, '10/2'],
      [GRANT, 'aucun'],
    ]);
  });

  it('un achat peut coûter toute la trésorerie, pas une obole de plus', async () => {
    const cityId = await newCity();
    const [seller, buyer] = [await newPlayer(cityId, 10), await newPlayer(cityId)];
    await order(seller, 'sell', GRANT + 1, 1);
    expect((await order(buyer, 'buy', GRANT + 1, 1)).body).toMatchObject({
      error: { code: 'INSUFFICIENT_FUNDS' },
    });
    await order(seller, 'sell', GRANT, 1);
    expect(await order(buyer, 'buy', GRANT, 1)).toMatchObject({
      status: 200,
      body: { data: { status: 'filled', trades: [{ price: GRANT, quantity: 1 }] } },
    });
    expect(await stateOf(buyer)).toEqual([0, '1/0']);
    expect(await eventsOf(cityId, 'OrderPlaced')).toHaveLength(3);
  });

  it('deux biens dans la même cité ont deux carnets distincts', async () => {
    const cityId = await newCity();
    const [seller, buyer] = [await newPlayer(cityId, 10), await newPlayer(cityId)];
    await give(seller, 'olives', 10);
    await order(seller, 'sell', 5, 10, undefined, 'olives');
    await order(seller, 'sell', 6, 10);
    expect((await order(buyer, 'buy', 6, 4)).body).toMatchObject({
      data: { status: 'filled', trades: [{ price: 6, quantity: 4 }] },
    });
    expect(await stateOf(buyer)).toEqual([GRANT - 24, '4/0']);
  });

  it('achats croisés simultanés : aucun interblocage', async () => {
    const cityId = await newCity();
    const [a, b] = [await newPlayer(cityId, 200), await newPlayer(cityId, 200)];
    await Promise.all([give(a, 'olives', 200), give(b, 'olives', 200)]);
    // Chaque tour : A et B vendent chacun un bien que l'autre achète, tout en même temps.
    for (let round = 0; round < 5; round++) {
      await Promise.all([
        order(a, 'sell', 6, 20),
        order(a, 'sell', 6, 20, undefined, 'olives'),
        order(b, 'sell', 6, 20),
        order(b, 'sell', 6, 20, undefined, 'olives'),
      ]);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => [
          order(a, 'buy', 6, 5),
          order(b, 'buy', 6, 5),
          order(a, 'buy', 6, 5, undefined, 'olives'),
          order(b, 'buy', 6, 5, undefined, 'olives'),
        ]).flat(),
      );
      expect(results.map((result) => result.status)).toEqual(results.map(() => 200));
    }
    // Chacun a vendu autant qu'il a acheté, au même prix.
    expect([await stateOf(a), await stateOf(b)]).toEqual([
      [GRANT, '200/0'],
      [GRANT, '200/0'],
    ]);
    expect(await ledgersAreConsistent([a, b])).toBe(0);
  });

  it('tick de demande des PNJ et ordres de joueurs en même temps : aucun interblocage', async () => {
    // La cité porte l'identifiant de la configuration : les PNJ y achètent du blé à chaque tick.
    const cityId = await newCity('kalliste');
    // Chaque maison vend et achète : son compte est crédité par le tick pendant qu'elle achète.
    const traders = await Promise.all(Array.from({ length: 4 }, () => newPlayer(cityId, 400)));
    const npcTick = () =>
      db.transaction().execute((trx) =>
        npcDemand.run({
          trx,
          worldId: WORLD,
          index: 0,
          scheduledAt: new Date(),
          config: TEST_CONFIG.config,
          rng: createRng('test'),
          dailyClose: false,
          seasonSwitch: false,
        }),
      );
    let npcUnits = 0;
    for (let round = 0; round < 6; round++) {
      await Promise.all(traders.map((trader) => order(trader, 'sell', 6, 40)));
      const [ticks, orders] = await Promise.all([
        Promise.all([npcTick(), npcTick()]),
        Promise.all(
          traders.flatMap((trader) => [
            order(trader, 'buy', 6, 5),
            order(trader, 'sell', 6, 10),
            order(trader, 'buy', 7, 5),
          ]),
        ),
      ]);
      expect(orders.map((result) => result.status)).toEqual(orders.map(() => 200));
      npcUnits += ticks.reduce((sum, tick) => sum + Number(tick['units']), 0);
    }
    expect(npcUnits).toBeGreaterThan(0);
    expect(await ledgersAreConsistent(traders)).toBe(0);
    // Entre maisons, la monnaie et le blé ne font que circuler : seuls les PNJ en créent et en consomment.
    const states = await Promise.all(traders.map(stateOf));
    const money = states.reduce((sum, [balance]) => sum + Number(balance) - GRANT, 0);
    const wheat = states.reduce((sum, [, stock]) => sum + Number(String(stock).split('/')[0]), 0);
    expect(4 * 400 - wheat).toBe(npcUnits);
    expect(money).toBe(npcUnits * 6);
  });

  it('une maison n’achète pas ses propres ventes', async () => {
    const seller = await newPlayer(await newCity(), 10);
    await order(seller, 'sell', 6, 10);
    expect((await order(seller, 'buy', 6, 10)).body).toMatchObject({
      data: { status: 'cancelled', trades: [] },
    });
    expect(await stateOf(seller)).toEqual([GRANT, '10/10']);
  });

  it('acheteurs simultanés et rejeu : chaque unité n’est vendue qu’une fois', async () => {
    const cityId = await newCity();
    const seller = await newPlayer(cityId, 40);
    await order(seller, 'sell', 6, 30);
    const buyers = await Promise.all(Array.from({ length: 5 }, () => newPlayer(cityId)));
    const results = await Promise.all(buyers.map((buyer) => order(buyer, 'buy', 6, 10)));
    expect(results.every((result) => result.status === 200)).toBe(true);
    // Rejeu : la même clé envoyée trois fois en même temps ne dépose qu'un ordre, alors que l'offre en servirait trois.
    const [replayer, key] = [await newPlayer(cityId), randomUUID()];
    await order(seller, 'sell', 6, 10);
    const replays = await Promise.all([1, 2, 3].map(() => order(replayer, 'buy', 6, 3, key)));
    expect(
      new Set(replays.map((r) => (r.body.data as unknown as { orderId: string }).orderId)).size,
    ).toBe(1);
    expect(await stateOf(replayer)).toEqual([GRANT - 18, '3/0']);
    const states = await Promise.all(buyers.map(stateOf));
    const boughtUnits = states.reduce((sum, [balance]) => sum + (GRANT - Number(balance)) / 6, 0);
    expect(boughtUnits).toBe(30);
    expect(await stateOf(seller)).toEqual([GRANT + 198, '7/7']);
    expect(await ledgersAreConsistent([seller, ...buyers])).toBe(0);
  });

  it('entrées refusées : bien ou cité inconnus, bornes de prix et de quantité, compte sans maison', async () => {
    const player = await newPlayer(await newCity(), 5);
    const place = (patch: Record<string, unknown>) =>
      send(player.user, 'market.placeOrder', {
        cityId: player.cityId,
        goodId: 'wheat',
        side: 'sell',
        price: 6,
        quantity: 1,
        ...patch,
      });
    expect((await place({ goodId: 'ambrosia' })).body).toMatchObject({
      error: { code: 'GOOD_NOT_FOUND' },
    });
    expect((await place({ cityId: randomUUID() })).body).toMatchObject({
      error: { code: 'CITY_NOT_FOUND' },
    });
    for (const patch of [
      { price: 0 },
      { price: 1.5 },
      { price: 1_000_000_001 },
      { quantity: 0 },
      { quantity: 1_000_001 },
      { side: 'hold' },
    ]) {
      expect((await place(patch)).body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    const homeless = randomUUID();
    expect(
      (
        await send(homeless, 'market.placeOrder', {
          cityId: player.cityId,
          goodId: 'wheat',
          side: 'sell',
          price: 6,
          quantity: 1,
        })
      ).body,
    ).toMatchObject({ error: { code: 'HOUSE_NOT_FOUND' } });
    expect(await stateOf(player)).toEqual([GRANT, '5/0']);
  });
});
