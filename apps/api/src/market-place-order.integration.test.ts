import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { npcDemand } from '@oikos/engine';
import { createRng } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createTelemetry } from './telemetry';
import { unlimited } from './rate-limit';
import { newAccount, TEST_CONFIG, testVerifier } from './test-config';

// Tests d'intégration de `market.placeOrder` contre Supabase local. Le fichier a son propre monde (cités et
// ordres ne se suppriment pas : rien ne doit apparaître dans le monde de test des autres suites), et chaque
// test sa propre cité : les carnets ne se mélangent pas d'un test à l'autre.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const telemetry = createTelemetry(db);
const owner = createDb(DATABASE_URL);
// Les tests d'appariement se lisent en montants bruts : taxe nulle, sauf dans le bloc « taxe de marché ».
let marketTax = { rateBps: 0, burnShareBps: 0 };
const app = createApp({
  db,
  telemetry,
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: async () => ({ ...TEST_CONFIG, config: { ...TEST_CONFIG.config, marketTax } }),
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

/** Cité qui porte l'identifiant de la configuration : les PNJ y achètent du blé à chaque tick. Une par monde. */
let kalliste: Promise<string> | undefined;
const kallisteCity = () => (kalliste ??= newCity('kalliste'));

/** Un tick de demande des PNJ, dans sa propre transaction. */
const npcTick = () =>
  db.transaction().execute((trx) =>
    npcDemand.run({
      trx,
      worldId: WORLD,
      index: 0,
      scheduledAt: new Date(),
      config: { ...TEST_CONFIG.config, marketTax },
      rng: createRng('test'),
      dailyClose: false,
      seasonSwitch: false,
      catchUp: false,
    }),
  );

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
    .where('kind', '=', 'house')
    .executeTakeFirstOrThrow();
  const stock = await db
    .selectFrom('game.inventories')
    .select(['quantity', 'reserved'])
    .where('house_id', '=', player.houseId)
    .where('good_id', '=', 'wheat')
    .executeTakeFirst();
  return [Number(account.balance), stock ? `${stock.quantity}/${stock.reserved}` : 'aucun'];
};
/** Monnaie retenue pour les achats en attente de la maison. */
const escrowOf = async (player: Player) =>
  Number(
    (
      await db
        .selectFrom('game.accounts')
        .select('balance')
        .where('house_id', '=', player.houseId)
        .where('kind', '=', 'escrow')
        .executeTakeFirst()
    )?.balance ?? 0,
  );
/** Ordres encore ouverts de ces maisons, du plus ancien au plus récent. */
const openOrdersOf = (players: Player[]) =>
  db
    .selectFrom('game.orders')
    .select(['id', 'house_id', 'side', 'price', 'remaining'])
    .where(
      'house_id',
      'in',
      players.map((player) => player.houseId),
    )
    .where('status', '=', 'open')
    .orderBy('seq')
    .execute();
/** Retire du carnet tout ce que ces maisons y ont laissé (les cités partagées restent propres). */
const cancelOpenOrders = async (players: Player[]) => {
  for (const open of await openOrdersOf(players)) {
    const player = players.find((candidate) => candidate.houseId === open.house_id);
    if (player) await send(player.user, 'market.cancelOrder', { orderId: open.id });
  }
};
/** Contrôles de la base : chaque solde et chaque stock égale la somme de son journal. */
const ledgersAreConsistent = async (players: Player[]) => {
  const houses = players.map((player) => player.houseId);
  const broken = await sql<{ n: string }>`
    select (select count(*) from game.account_balance_check c join game.accounts a on a.id = c.account_id
            where a.house_id = any(${houses}::uuid[]) and not c.ok)
         + (select count(*) from game.inventory_quantity_check c join game.inventories i on i.id = c.inventory_id
            where i.house_id = any(${houses}::uuid[]) and not c.ok)
         -- Séquestre de chaque maison = somme des restes à payer de ses achats ouverts.
         + (select count(*) from unnest(${houses}::uuid[]) h
            where (select coalesce(sum(a.balance), 0) from game.accounts a where a.house_id = h and a.kind = 'escrow')
               <> (select coalesce(sum(o.price * o.remaining), 0) from game.orders o
                    where o.house_id = h and o.side = 'buy' and o.status = 'open')) as n`.execute(
    db,
  );
  return Number(broken.rows[0]?.n);
};

const idOf = (result: { body: { data?: never } }) =>
  (result.body.data as unknown as { orderId: string }).orderId;

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

  it('un achat sert les ventes de la moins chère à la plus chère, au prix de chacune ; son reste attend, payé d’avance', async () => {
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
          status: 'open',
          remaining: 10,
          shortOfFunds: false,
          trades: [
            { price: 6, quantity: 20 },
            { price: 9, quantity: 30 },
          ],
        },
      },
    });
    const paid = 6 * 20 + 9 * 30;
    // Le reste attend à 10 oboles : 100 oboles quittent la trésorerie pour le séquestre.
    expect(await stateOf(buyer)).toEqual([GRANT - paid - 100, '50/0']);
    expect(await escrowOf(buyer)).toBe(100);
    expect(await stateOf(cheap)).toEqual([GRANT + 120, '30/0']);
    expect(await stateOf(dear)).toEqual([GRANT + 270, '20/10']);
    expect(await ledgersAreConsistent([cheap, dear, buyer])).toBe(0);
    const book = await sql<{ side: string; price: string; quantity: string }>`
      select side, price, quantity from game.order_book() where city_id = ${cityId} order by side`.execute(
      owner,
    );
    expect(book.rows).toEqual([
      { side: 'buy', price: '10', quantity: '10' },
      { side: 'sell', price: '20', quantity: '10' },
    ]);
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

  it('achat sans contrepartie : il attend, payé d’avance ; au-dessus de ses moyens : refusé, rien ne bouge', async () => {
    const cityId = await newCity();
    const [seller, buyer] = [await newPlayer(cityId, 10), await newPlayer(cityId)];
    expect((await order(buyer, 'buy', 5, 3)).body).toMatchObject({
      data: { status: 'open', remaining: 3, trades: [], shortOfFunds: false },
    });
    expect([await stateOf(buyer), await escrowOf(buyer)]).toEqual([[GRANT - 15, 'aucun'], 15]);
    // Carnet vide à ce prix, et pas de quoi retenir la somme : l'achat est refusé, rien n'est retenu.
    expect(await order(buyer, 'buy', GRANT, 1)).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_FUNDS' } },
    });
    // Une vente attend au prix limite, mais pas même une unité n'est payable : l'achat est refusé.
    await order(seller, 'sell', GRANT + 1, 2);
    expect(await order(buyer, 'buy', GRANT + 1, 2)).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_FUNDS' } },
    });
    expect([await stateOf(seller), await stateOf(buyer)]).toEqual([
      [GRANT, '10/2'],
      [GRANT - 15, 'aucun'],
    ]);
    expect(await escrowOf(buyer)).toBe(15);
    expect(await ledgersAreConsistent([seller, buyer])).toBe(0);
  });

  it('achat au-delà de ses moyens : exécuté pour la part payable, du moins cher au plus cher, et signalé', async () => {
    const cityId = await newCity();
    const [seller, buyer] = [await newPlayer(cityId, 100), await newPlayer(cityId)];
    // 40 unités à 50 oboles (2 000), puis 40 à 100 : la dotation paie les premières et dix des secondes.
    await order(seller, 'sell', 100, 40);
    await order(seller, 'sell', 50, 40);
    const affordable = (GRANT - 40 * 50) / 100;
    expect(GRANT).toBe(3000);
    const bought = await order(buyer, 'buy', 100, 80);
    expect(bought).toMatchObject({
      status: 200,
      body: {
        data: {
          status: 'cancelled',
          remaining: 80 - 40 - affordable,
          shortOfFunds: true,
          trades: [
            { price: 50, quantity: 40 },
            { price: 100, quantity: affordable },
          ],
        },
      },
    });
    // Toute la trésorerie y est passée, pas une obole de plus ; le reste des ventes attend toujours.
    expect([await stateOf(seller), await stateOf(buyer)]).toEqual([
      [2 * GRANT, `${100 - 40 - affordable}/${40 - affordable}`],
      [0, `${40 + affordable}/0`],
    ]);
    expect(await ledgersAreConsistent([seller, buyer])).toBe(0);
    // Le journal dit que le reste a été annulé, pas mis en attente.
    expect(await eventsOf(cityId, 'OrderCancelled')).toEqual([
      {
        orderId: idOf(bought),
        houseId: buyer.houseId,
        cityId,
        goodId: 'wheat',
        side: 'buy',
        released: 80 - 40 - affordable,
      },
    ]);
    // Un achat entièrement payable, lui, ne signale rien.
    const other = await newPlayer(cityId);
    expect((await order(other, 'buy', 100, 5)).body).toMatchObject({
      data: { status: 'filled', shortOfFunds: false },
    });
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
    const cityId = await kallisteCity();
    // Chaque maison vend et achète : son compte est crédité par le tick pendant qu'elle achète.
    const traders = await Promise.all(Array.from({ length: 4 }, () => newPlayer(cityId, 400)));
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
    const held = (await Promise.all(traders.map(escrowOf))).reduce(
      (sum, escrow) => sum + escrow,
      0,
    );
    const money = states.reduce((sum, [balance]) => sum + Number(balance) - GRANT, held);
    const wheat = states.reduce((sum, [, stock]) => sum + Number(String(stock).split('/')[0]), 0);
    expect(4 * 400 - wheat).toBe(npcUnits);
    expect(money).toBe(npcUnits * 6);
    // La cité sert à d'autres tests : rien de ces maisons ne reste au carnet, et tout séquestre est rendu.
    await cancelOpenOrders(traders);
    expect(await openOrdersOf(traders)).toEqual([]);
    expect(await Promise.all(traders.map(escrowOf))).toEqual([0, 0, 0, 0]);
    expect(await ledgersAreConsistent(traders)).toBe(0);
  });

  it('une maison n’échange pas avec elle-même : ni son achat contre sa vente, ni sa vente contre son achat', async () => {
    const cityId = await newCity();
    const [house, other] = [await newPlayer(cityId, 20), await newPlayer(cityId, 20)];
    await order(house, 'sell', 6, 10);
    // Son achat croise sa propre vente : il ne l'exécute pas, il attend à côté d'elle.
    expect((await order(house, 'buy', 8, 10)).body).toMatchObject({
      data: { status: 'open', remaining: 10, trades: [] },
    });
    expect([await stateOf(house), await escrowOf(house)]).toEqual([[GRANT - 80, '20/10'], 80]);
    // Sa vente croise son propre achat en attente : elle ne l'exécute pas non plus.
    expect((await order(house, 'sell', 7, 5)).body).toMatchObject({
      data: { status: 'open', remaining: 5, trades: [] },
    });
    expect([await stateOf(house), await escrowOf(house)]).toEqual([[GRANT - 80, '20/15'], 80]);
    // Une autre maison, elle, est servie par cet achat, au prix de l'achat.
    expect((await order(other, 'sell', 7, 4)).body).toMatchObject({
      data: { status: 'filled', trades: [{ price: 8, quantity: 4 }] },
    });
    expect([await stateOf(house), await escrowOf(house)]).toEqual([[GRANT - 80, '24/15'], 48]);
    const own = await sql<{ n: string }>`
      select count(*) as n from game.trades t
      join game.orders s on s.id = t.sell_order_id join game.orders b on b.id = t.buy_order_id
      where s.house_id = b.house_id and s.city_id = ${cityId}`.execute(db);
    expect(Number(own.rows[0]?.n)).toBe(0);
    expect(await ledgersAreConsistent([house, other])).toBe(0);
  });

  it('une vente sert les achats en attente du plus cher au moins cher, puis par ancienneté, au prix de chacun, payée par leur séquestre', async () => {
    const cityId = await newCity();
    const [low, first, second, seller] = [
      await newPlayer(cityId),
      await newPlayer(cityId),
      await newPlayer(cityId),
      await newPlayer(cityId, 100),
    ];
    const lowId = idOf(await order(low, 'buy', 7, 10));
    const firstId = idOf(await order(first, 'buy', 9, 10));
    const secondId = idOf(await order(second, 'buy', 9, 10));
    await order(low, 'buy', 5, 10);
    expect(await Promise.all([low, first, second].map(escrowOf))).toEqual([120, 90, 90]);

    // 26 unités à 6 oboles au moins : les deux achats à 9 (le plus ancien d'abord), puis 6 unités à 7.
    const sold = await order(seller, 'sell', 6, 26);
    expect(sold).toMatchObject({
      status: 200,
      body: {
        data: {
          status: 'filled',
          remaining: 0,
          trades: [
            { price: 9, quantity: 10 },
            { price: 9, quantity: 10 },
            { price: 7, quantity: 6 },
          ],
        },
      },
    });
    expect(sold.body.data).not.toHaveProperty('shortOfFunds');
    const sellOrderId = idOf(sold);
    expect(await eventsOf(cityId, 'TradeExecuted')).toMatchObject([
      { sellOrderId, buyOrderId: firstId, price: 9, quantity: 10 },
      { sellOrderId, buyOrderId: secondId, price: 9, quantity: 10 },
      { sellOrderId, buyOrderId: lowId, price: 7, quantity: 6 },
    ]);
    // Le vendeur touche le prix de chaque achat ; les acheteurs reçoivent le blé sans repayer.
    expect(await stateOf(seller)).toEqual([GRANT + 180 + 42, '74/0']);
    expect(await stateOf(first)).toEqual([GRANT - 90, '10/0']);
    expect(await stateOf(second)).toEqual([GRANT - 90, '10/0']);
    expect(await stateOf(low)).toEqual([GRANT - 120, '6/0']);
    // Il reste au séquestre de quoi payer ce qui attend encore : 4 unités à 7 et 10 à 5.
    expect(await Promise.all([low, first, second].map(escrowOf))).toEqual([78, 0, 0]);
    expect(await ledgersAreConsistent([low, first, second, seller])).toBe(0);

    // Une vente plus grosse que la demande : servie pour ce qui croise, le reste attend et réserve son stock.
    expect((await order(seller, 'sell', 7, 30)).body).toMatchObject({
      data: { status: 'open', remaining: 26, trades: [{ price: 7, quantity: 4 }] },
    });
    expect(await stateOf(seller)).toEqual([GRANT + 222 + 28, '70/26']);
    expect(await escrowOf(low)).toBe(50);
    // Chaque échange est réglé par le séquestre de l'acheteur, et livré par un mouvement qui porte l'écriture.
    const settled = await sql<{ payer: string; moved: string }>`
      select a.kind as payer,
             (select string_agg(s.quantity::text, ',') from game.stock_ledger s
               where s.ledger_entry_id = t.ledger_entry_id) as moved
      from game.trades t
      join game.ledger_lines l on l.entry_id = t.ledger_entry_id and l.amount < 0
      join game.accounts a on a.id = l.account_id
      where t.sell_order_id = ${sellOrderId} order by t.id`.execute(db);
    expect(settled.rows).toEqual([
      { payer: 'escrow', moved: '10' },
      { payer: 'escrow', moved: '10' },
      { payer: 'escrow', moved: '6' },
    ]);
    expect(await ledgersAreConsistent([low, first, second, seller])).toBe(0);
  });

  it('acheteurs simultanés et rejeu : chaque unité n’est vendue qu’une fois', async () => {
    const cityId = await newCity();
    const seller = await newPlayer(cityId, 60);
    await order(seller, 'sell', 6, 30);
    const buyers = await Promise.all(Array.from({ length: 5 }, () => newPlayer(cityId)));
    const results = await Promise.all(buyers.map((buyer) => order(buyer, 'buy', 6, 10)));
    expect(results.every((result) => result.status === 200)).toBe(true);
    // Trois acheteurs sont servis, deux attendent ; la vente suivante sert ceux qui attendent.
    const statuses = results.map((r) => (r.body.data as unknown as { status: string }).status);
    expect(statuses.sort()).toEqual(['filled', 'filled', 'filled', 'open', 'open']);
    expect((await order(seller, 'sell', 6, 20)).body).toMatchObject({
      data: { status: 'filled', trades: [{ quantity: 10 }, { quantity: 10 }] },
    });
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
    expect(boughtUnits).toBe(50);
    expect(states.map(([, stock]) => stock)).toEqual(buyers.map(() => '10/0'));
    expect(await stateOf(seller)).toEqual([GRANT + 318, '7/7']);
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
    const homeless = await newAccount(owner);
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

describe('market.cancelOrder', () => {
  const cancel = (player: Player, orderId: string, key?: string) =>
    send(player.user, 'market.cancelOrder', { orderId }, key);
  const statusOf = async (orderId: string) =>
    (
      await db
        .selectFrom('game.orders')
        .select('status')
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow()
    ).status;

  it('annule une vente ouverte : le stock réservé est libéré, plus personne ne peut la servir', async () => {
    const cityId = await newCity();
    const [seller, buyer] = [await newPlayer(cityId, 100), await newPlayer(cityId)];
    const orderId = idOf(await order(seller, 'sell', 6, 60));
    expect(await stateOf(seller)).toEqual([GRANT, '100/60']);

    expect(await cancel(seller, orderId)).toEqual({
      status: 200,
      body: { ok: true, data: { orderId, status: 'cancelled', released: 60 } },
    });
    expect(await statusOf(orderId)).toBe('cancelled');
    expect(await stateOf(seller)).toEqual([GRANT, '100/0']);
    expect(await eventsOf(cityId, 'OrderCancelled')).toEqual([
      { orderId, houseId: seller.houseId, cityId, goodId: 'wheat', side: 'sell', released: 60 },
    ]);
    // Le carnet est vide : un acheteur ne trouve plus rien, le stock libéré se revend.
    expect((await order(buyer, 'buy', 10, 60)).body).toMatchObject({
      data: { trades: [], remaining: 60 },
    });
    expect((await order(seller, 'sell', 7, 100)).status).toBe(200);
  });

  it('après une exécution partielle, seul le reste est libéré ; ce qui est vendu reste vendu', async () => {
    const cityId = await newCity();
    const [seller, buyer] = [await newPlayer(cityId, 100), await newPlayer(cityId)];
    const orderId = idOf(await order(seller, 'sell', 6, 60));
    await order(buyer, 'buy', 6, 20);
    expect((await cancel(seller, orderId)).body).toMatchObject({ data: { released: 40 } });
    expect(await stateOf(seller)).toEqual([GRANT + 120, '80/0']);
    expect(await stateOf(buyer)).toEqual([GRANT - 120, '20/0']);
    expect(await ledgersAreConsistent([seller, buyer])).toBe(0);
  });

  it("l'ordre d'un autre joueur est indiscernable d'un ordre inexistant, et reste intact", async () => {
    const cityId = await newCity();
    const [seller, other] = [await newPlayer(cityId, 100), await newPlayer(cityId)];
    const orderId = idOf(await order(seller, 'sell', 6, 60));
    const foreign = await cancel(other, orderId);
    const unknown = await cancel(other, randomUUID());
    expect(foreign).toEqual({
      status: 404,
      body: { ok: false, error: { code: 'ORDER_NOT_FOUND', message: 'Unknown order.' } },
    });
    expect(unknown).toEqual(foreign);
    expect(await statusOf(orderId)).toBe('open');
    expect(await stateOf(seller)).toEqual([GRANT, '100/60']);
    expect(await eventsOf(cityId, 'OrderCancelled')).toEqual([]);
  });

  it("l'ordre d'un autre joueur n'est ni verrouillé ni attendu : pas de délai observable", async () => {
    const cityId = await newCity();
    const [seller, other] = [await newPlayer(cityId, 100), await newPlayer(cityId)];
    const orderId = idOf(await order(seller, 'sell', 6, 60));
    // Une transaction tierce tient la ligne (comme le ferait un tick en cours).
    const holder = await owner.startTransaction().execute();
    try {
      await sql`select 1 from game.orders where id = ${orderId} for update`.execute(holder);
      const answer = await Promise.race([
        cancel(other, orderId),
        new Promise<'waited'>((resolve) => setTimeout(() => resolve('waited'), 2000)),
      ]);
      expect(answer).toMatchObject({ status: 404, body: { error: { code: 'ORDER_NOT_FOUND' } } });
    } finally {
      await holder.rollback().execute();
    }
    expect(await statusOf(orderId)).toBe('open');
  });

  it('un ordre déjà annulé ou entièrement servi ne s’annule pas ; le rejeu de la même clé rend la même réponse', async () => {
    const cityId = await newCity();
    const [seller, buyer] = [await newPlayer(cityId, 100), await newPlayer(cityId)];
    const cancelled = idOf(await order(seller, 'sell', 6, 30));
    const key = randomUUID();
    const first = await cancel(seller, cancelled, key);
    expect(first.status).toBe(200);
    expect(await cancel(seller, cancelled, key)).toEqual(first);
    expect(await cancel(seller, cancelled)).toMatchObject({
      status: 409,
      body: { error: { code: 'ORDER_NOT_OPEN' } },
    });
    const filled = idOf(await order(seller, 'sell', 6, 10));
    await order(buyer, 'buy', 6, 10);
    expect((await cancel(seller, filled)).body).toMatchObject({
      error: { code: 'ORDER_NOT_OPEN' },
    });
    // Un achat exécuté en entier à l'arrivée est déjà clos : son auteur ne peut pas l'annuler non plus.
    await order(seller, 'sell', 6, 5);
    const bought = idOf(await order(buyer, 'buy', 6, 5));
    expect((await cancel(buyer, bought)).body).toMatchObject({ error: { code: 'ORDER_NOT_OPEN' } });
    expect(await eventsOf(cityId, 'OrderCancelled')).toHaveLength(1);
    expect(await stateOf(seller)).toEqual([GRANT + 90, '85/0']);
  });

  it('annulation et achat simultanés : quantité servie + quantité libérée = quantité de l’ordre', async () => {
    const cityId = await newCity();
    const [seller, buyer] = [await newPlayer(cityId, 400), await newPlayer(cityId)];
    let [sold, releasedTotal, cancelledFirst, boughtFirst] = [0, 0, 0, 0];
    for (let round = 0; round < 20; round++) {
      const orderId = idOf(await order(seller, 'sell', 6, 10));
      const [bought, cancelling] = await Promise.all([
        order(buyer, 'buy', 6, 4),
        cancel(seller, orderId),
      ]);
      expect([bought.status, cancelling.status]).toEqual([200, 200]);
      const traded = (bought.body.data as unknown as { trades: { quantity: number }[] }).trades
        .map((trade) => trade.quantity)
        .reduce((sum, quantity) => sum + quantity, 0);
      const released = (cancelling.body.data as unknown as { released: number }).released;
      // L'achat passe en entier avant l'annulation, ou pas du tout après.
      expect([
        [4, 6],
        [0, 10],
      ]).toContainEqual([traded, released]);
      expect(await statusOf(orderId)).toBe('cancelled');
      // Arrivé après l'annulation, l'achat attend : il est retiré avant le tour suivant.
      if (traded === 0) expect((await cancel(buyer, idOf(bought))).status).toBe(200);
      sold += traded;
      releasedTotal += released;
      if (traded === 0) cancelledFirst += 1;
      else boughtFirst += 1;
    }
    expect(sold + releasedTotal).toBe(200);
    expect(cancelledFirst + boughtFirst).toBe(20);
    expect(await stateOf(seller)).toEqual([GRANT + sold * 6, `${400 - sold}/0`]);
    expect(await stateOf(buyer)).toEqual([GRANT - sold * 6, sold > 0 ? `${sold}/0` : 'aucun']);
    expect(await escrowOf(buyer)).toBe(0);
    expect(await ledgersAreConsistent([seller, buyer])).toBe(0);
  });

  it('annule un achat en attente : le séquestre rend prix × reste, ce qui est acheté reste acquis', async () => {
    const cityId = await newCity();
    const [buyer, seller] = [await newPlayer(cityId), await newPlayer(cityId, 50)];
    const orderId = idOf(await order(buyer, 'buy', 8, 30));
    expect([await stateOf(buyer), await escrowOf(buyer)]).toEqual([[GRANT - 240, 'aucun'], 240]);
    await order(seller, 'sell', 8, 12);
    expect([await stateOf(buyer), await escrowOf(buyer)]).toEqual([[GRANT - 240, '12/0'], 144]);

    expect(await cancel(buyer, orderId)).toEqual({
      status: 200,
      body: { ok: true, data: { orderId, status: 'cancelled', released: 18 } },
    });
    expect([await stateOf(buyer), await escrowOf(buyer)]).toEqual([[GRANT - 96, '12/0'], 0]);
    expect(await stateOf(seller)).toEqual([GRANT + 96, '38/0']);
    expect(await eventsOf(cityId, 'OrderCancelled')).toEqual([
      { orderId, houseId: buyer.houseId, cityId, goodId: 'wheat', side: 'buy', released: 18 },
    ]);
    // Mise en attente puis restitution : deux écritures équilibrées entre les deux comptes de la maison.
    const moves = await sql<{ kind: string; amounts: string }>`
      select e.kind, string_agg(a.kind || ':' || l.amount, ' ' order by a.kind) as amounts
      from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
      join game.accounts a on a.id = l.account_id
      where a.house_id = ${buyer.houseId} and e.kind like 'market.escrow%'
      group by e.id, e.kind order by e.id`.execute(db);
    expect(moves.rows).toEqual([
      { kind: 'market.escrow_hold', amounts: 'escrow:240 house:-240' },
      { kind: 'market.escrow_release', amounts: 'escrow:-144 house:144' },
    ]);
    // Plus rien n'attend : une vente au même prix ne trouve personne et reste au carnet.
    expect((await order(seller, 'sell', 8, 5)).body).toMatchObject({
      data: { status: 'open', trades: [] },
    });
    expect(await cancel(buyer, orderId)).toMatchObject({
      status: 409,
      body: { error: { code: 'ORDER_NOT_OPEN' } },
    });
    expect(await ledgersAreConsistent([buyer, seller])).toBe(0);
  });

  it('même maison : achats mis en attente et annulations d’autres achats simultanés, sans interblocage', async () => {
    // L'annulation verrouille la trésorerie avant le séquestre, comme la mise en attente.
    const cityId = await newCity();
    const [buyer, seller] = [await newPlayer(cityId), await newPlayer(cityId, 400)];
    for (let round = 0; round < 10; round++) {
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) ids.push(idOf(await order(buyer, 'buy', 6, 10)));
      const results = await Promise.all([
        ...ids.map((id) => cancel(buyer, id)),
        ...ids.map(() => order(buyer, 'buy', 5, 3)),
        order(seller, 'sell', 6, 4),
        order(seller, 'sell', 5, 2),
      ]);
      expect(results.map((result) => result.status)).toEqual(results.map(() => 200));
      await cancelOpenOrders([buyer, seller]);
    }
    expect(await escrowOf(buyer)).toBe(0);
    expect(await ledgersAreConsistent([buyer, seller])).toBe(0);
  });

  it('annulation d’un achat et vente simultanées : payé + rendu = retenu, sans interblocage', async () => {
    const cityId = await newCity();
    const [buyer, seller] = [await newPlayer(cityId), await newPlayer(cityId, 400)];
    let [bought, soldFirst, cancelledFirst] = [0, 0, 0];
    for (let round = 0; round < 20; round++) {
      const orderId = idOf(await order(buyer, 'buy', 6, 10));
      const [selling, cancelling] = await Promise.all([
        order(seller, 'sell', 6, 4),
        cancel(buyer, orderId),
      ]);
      expect([selling.status, cancelling.status]).toEqual([200, 200]);
      const sale = selling.body.data as unknown as {
        status: string;
        trades: { quantity: number }[];
      };
      const traded = sale.trades.reduce((sum, trade) => sum + trade.quantity, 0);
      const released = (cancelling.body.data as unknown as { released: number }).released;
      // La vente passe en entier avant l'annulation, ou pas du tout après.
      expect([
        [4, 6],
        [0, 10],
      ]).toContainEqual([traded, released]);
      // Arrivée après l'annulation, la vente attend : elle est retirée avant le tour suivant.
      if (traded === 0) expect((await cancel(seller, idOf(selling))).status).toBe(200);
      bought += traded;
      if (traded === 0) cancelledFirst += 1;
      else soldFirst += 1;
    }
    expect(cancelledFirst + soldFirst).toBe(20);
    expect(await stateOf(buyer)).toEqual([
      GRANT - bought * 6,
      bought > 0 ? `${bought}/0` : 'aucun',
    ]);
    expect(await escrowOf(buyer)).toBe(0);
    expect(await stateOf(seller)).toEqual([GRANT + bought * 6, `${400 - bought}/0`]);
    expect(await ledgersAreConsistent([buyer, seller])).toBe(0);
  });

  it('annulation pendant un tick de demande des PNJ : elle attend la fin du tick et ne libère que le reste', async () => {
    const cityId = await kallisteCity();
    const seller = await newPlayer(cityId, 100);
    // D'autres ventes attendent dans cette cité : celle-ci, moins chère, est servie la première.
    const PRICE = 5;
    const orderId = idOf(await order(seller, 'sell', PRICE, 50));
    const remainingOf = async () =>
      Number(
        (
          await owner
            .selectFrom('game.orders')
            .select('remaining')
            .where('id', '=', orderId)
            .executeTakeFirstOrThrow()
        ).remaining,
      );
    const waiting = async () =>
      Number(
        (
          await sql<{ n: string }>`select count(*) as n from pg_stat_activity
            where wait_event_type = 'Lock' and query like '%game%orders%' and query not like '%pg_stat_activity%'`.execute(
            owner,
          )
        ).rows[0]?.n,
      );

    let cancelling: ReturnType<typeof cancel> | undefined;
    await db.transaction().execute(async (trx) => {
      await npcDemand.run({
        trx,
        worldId: WORLD,
        index: 0,
        scheduledAt: new Date(),
        config: { ...TEST_CONFIG.config, marketTax },
        rng: createRng('test'),
        dailyClose: false,
        seasonSwitch: false,
        catchUp: false,
      });
      // Le tick a servi l'ordre mais n'a pas encore validé : l'annulation arrive maintenant.
      cancelling = cancel(seller, orderId);
      for (let tries = 0; (await waiting()) < 1; tries += 1) {
        if (tries > 200) throw new Error('the cancellation never queued behind the tick');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // Tant que le tick n'a pas validé, rien n'est annulé.
      expect(await remainingOf()).toBe(50);
    });
    const outcome = await cancelling;
    const sold = 50 - (await remainingOf());
    // Les PNJ ont acheté à ce prix : sans cela le test ne prouverait rien.
    expect(sold).toBeGreaterThan(0);
    if (sold < 50) {
      expect(outcome).toMatchObject({ status: 200, body: { data: { released: 50 - sold } } });
      expect(await statusOf(orderId)).toBe('cancelled');
    } else {
      expect(outcome?.body).toMatchObject({ error: { code: 'ORDER_NOT_OPEN' } });
      expect(await statusOf(orderId)).toBe('filled');
    }
    expect(await stateOf(seller)).toEqual([GRANT + sold * PRICE, `${100 - sold}/0`]);
    expect(await ledgersAreConsistent([seller])).toBe(0);

    // Dans l'autre sens : un ordre annulé avant le tick n'est pas servi.
    const next = idOf(await order(seller, 'sell', PRICE, 10));
    expect((await cancel(seller, next)).status).toBe(200);
    await npcTick();
    expect(await stateOf(seller)).toEqual([GRANT + sold * PRICE, `${100 - sold}/0`]);
  });
});

describe('taxe de marché', () => {
  afterAll(() => {
    marketTax = { rateBps: 0, burnShareBps: 0 };
  });
  const balanceOf = async (where: { city_id: string } | { system_key: string }) => {
    const [column, value] = Object.entries(where)[0] as ['city_id' | 'system_key', string];
    const account = await db
      .selectFrom('game.accounts')
      .select('balance')
      .where('world_id', '=', WORLD)
      .where(column, '=', value)
      .executeTakeFirstOrThrow();
    return Number(account.balance);
  };
  const sinkOf = () => balanceOf({ system_key: 'sink_market_tax' });
  /** Lignes « type de compte:montant » de l'écriture de chaque échange de la cité, dans l'ordre des échanges. */
  const entriesOf = async (cityId: string) =>
    (
      await sql<{ lines: string }>`
        select (select string_agg(a.kind || ':' || l.amount, ' ' order by l.amount, a.kind)
                  from game.ledger_lines l join game.accounts a on a.id = l.account_id
                 where l.entry_id = t.ledger_entry_id) as lines
        from game.trades t join game.orders o on o.id = t.sell_order_id
        where o.city_id = ${cityId} order by t.id`.execute(db)
    ).rows.map((row) => row.lines);

  it('vente servie ou qui sert : l’acheteur paie le brut, le vendeur reçoit le net, le reste va au puits et au trésor, dans l’écriture du paiement', async () => {
    const cityId = await newCity();
    const [buyer, seller] = [await newPlayer(cityId), await newPlayer(cityId, 100)];
    const sink = await sinkOf();
    marketTax = { rateBps: 500, burnShareBps: 5000 };
    // L'achat arrive sur une vente en attente : 20 × 6 = 120, taxe 6, dont 3 détruites.
    await order(seller, 'sell', 6, 20);
    expect((await order(buyer, 'buy', 6, 20)).body).toMatchObject({ data: { status: 'filled' } });
    expect(await stateOf(seller)).toEqual([GRANT + 114, '80/0']);
    expect(await stateOf(buyer)).toEqual([GRANT - 120, '20/0']);
    // La vente arrive sur un achat en attente, payé par son séquestre : 7 × 3 = 21, taxe ⌈1,05⌉ = 2.
    await order(buyer, 'buy', 3, 7);
    expect((await order(seller, 'sell', 2, 7)).body).toMatchObject({ data: { status: 'filled' } });
    expect(await stateOf(seller)).toEqual([GRANT + 114 + 19, '73/0']);
    expect(await stateOf(buyer)).toEqual([GRANT - 141, '27/0']);
    expect(await entriesOf(cityId)).toEqual([
      'house:-120 system:3 treasury:3 house:114',
      'escrow:-21 system:1 treasury:1 house:19',
    ]);
    // Rien ne se crée : ce que les maisons ont perdu est au trésor ou détruit, à l'obole près.
    const [treasury, burned] = [await balanceOf({ city_id: cityId }), (await sinkOf()) - sink];
    expect([treasury, burned]).toEqual([4, 4]);
    const held = await sql<{ total: string }>`
      select sum(balance) as total from game.accounts
      where house_id = any(${[buyer.houseId, seller.houseId]}::uuid[])`.execute(db);
    expect(Number(held.rows[0]?.total) + treasury + burned).toBe(2 * GRANT);
    expect(await ledgersAreConsistent([buyer, seller])).toBe(0);
  });

  it('arrondi par échange, à l’obole supérieure ; une part nulle ne fait pas de ligne ; taux nul : rien n’est prélevé', async () => {
    const cityId = await newCity();
    const [buyer, seller] = [await newPlayer(cityId), await newPlayer(cityId, 100)];
    const sink = await sinkOf();
    // Trois achats d'une unité à 6 : trois échanges, une obole de taxe chacun (5 % de 6 = 0,3), toute détruite.
    marketTax = { rateBps: 500, burnShareBps: 5000 };
    for (let n = 0; n < 3; n += 1) await order(buyer, 'buy', 6, 1);
    await order(seller, 'sell', 6, 3);
    expect(await stateOf(seller)).toEqual([GRANT + 15, '97/0']);
    // Tout au trésor, puis une vente d'une obole : la taxe la prend entière, le vendeur ne reçoit rien.
    marketTax = { rateBps: 500, burnShareBps: 0 };
    await order(seller, 'sell', 6, 1);
    await order(buyer, 'buy', 6, 1);
    await order(seller, 'sell', 1, 1);
    await order(buyer, 'buy', 1, 1);
    expect(await stateOf(seller)).toEqual([GRANT + 15 + 5, '95/0']);
    marketTax = { rateBps: 0, burnShareBps: 10_000 };
    await order(seller, 'sell', 6, 5);
    await order(buyer, 'buy', 6, 5);
    expect(await stateOf(seller)).toEqual([GRANT + 20 + 30, '90/0']);
    expect(await entriesOf(cityId)).toEqual([
      ...Array.from({ length: 3 }, () => 'escrow:-6 system:1 house:5'),
      'house:-6 treasury:1 house:5',
      'house:-1 treasury:1',
      'house:-30 house:30',
    ]);
    expect([await balanceOf({ city_id: cityId }), (await sinkOf()) - sink]).toEqual([2, 3]);
    expect(await ledgersAreConsistent([buyer, seller])).toBe(0);
  });

  it('achat en attente servi en partie : taxe sur la part servie, le séquestre retient encore le reste', async () => {
    const cityId = await newCity();
    const [buyer, seller] = [await newPlayer(cityId), await newPlayer(cityId, 100)];
    marketTax = { rateBps: 500, burnShareBps: 5000 };
    await order(buyer, 'buy', 6, 10);
    // 4 × 6 = 24, taxe ⌈1,2⌉ = 2 : une obole détruite, une au trésor.
    expect((await order(seller, 'sell', 6, 4)).body).toMatchObject({ data: { status: 'filled' } });
    expect(await entriesOf(cityId)).toEqual(['escrow:-24 system:1 treasury:1 house:22']);
    expect([await stateOf(seller), await stateOf(buyer), await escrowOf(buyer)]).toEqual([
      [GRANT + 22, '96/0'],
      [GRANT - 60, '4/0'],
      36,
    ]);
    expect(await openOrdersOf([buyer])).toMatchObject([{ side: 'buy', remaining: '6' }]);
    expect(await ledgersAreConsistent([buyer, seller])).toBe(0);
  });

  it('ticks des PNJ et ordres taxés en même temps : aucun interblocage sur le puits et le trésor, rien ne se crée hors du robinet', async () => {
    const cityId = await kallisteCity();
    const traders = await Promise.all(Array.from({ length: 4 }, () => newPlayer(cityId, 400)));
    const before = (await balanceOf({ city_id: cityId })) + (await sinkOf());
    marketTax = { rateBps: 500, burnShareBps: 5000 };
    let npcSpent = 0;
    for (let round = 0; round < 4; round++) {
      await Promise.all(traders.map((trader) => order(trader, 'sell', 6, 40)));
      const [ticks, orders] = await Promise.all([
        Promise.all([npcTick(), npcTick()]),
        Promise.all(
          traders.flatMap((trader) => [order(trader, 'buy', 7, 5), order(trader, 'sell', 6, 10)]),
        ),
      ]);
      expect(orders.map((result) => result.status)).toEqual(orders.map(() => 200));
      npcSpent += ticks.reduce((sum, tick) => sum + Number(tick['spent']), 0);
    }
    expect(npcSpent).toBeGreaterThan(0);
    await cancelOpenOrders(traders);
    const levied = (await balanceOf({ city_id: cityId })) + (await sinkOf()) - before;
    const money = (await Promise.all(traders.map(stateOf))).reduce(
      (sum, [balance]) => sum + Number(balance) - GRANT,
      0,
    );
    expect(levied).toBeGreaterThan(0);
    expect(money + levied).toBe(npcSpent);
    expect(await ledgersAreConsistent(traders)).toBe(0);
  });
});
