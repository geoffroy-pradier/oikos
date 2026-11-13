import { randomUUID } from 'node:crypto';
import { createDb } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { TEST_CONFIG, testConfig } from './test-config';

// Tests d'intégration de `market.placeOrder` contre Supabase local. Chaque test a sa propre cité :
// les carnets ne se mélangent pas d'un test à l'autre.
const db = createDb(
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
);
const app = createApp({
  db,
  verifyToken: async (token) => (token.length === 36 ? token : null),
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
afterAll(() => db.destroy());

const WORLD = '01900000-0000-7000-8000-000000000001';
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

async function newCity(): Promise<string> {
  const id = randomUUID();
  await sql`insert into game.cities (id, world_id, slug, name) values (${id}, ${WORLD}, ${`c-${letters()}`}, 'Agora de test')`.execute(
    db,
  );
  return id;
}

/** Fonde une maison dans la cité par la commande réelle, et lui donne du blé par le journal des stocks. */
async function newPlayer(cityId: string, wheat = 0) {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    db,
  );
  const founded = await send(user, 'house.create', {
    cityId,
    name: `Agora ${letters()}`,
    blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
  });
  const houseId = (founded.body.data as unknown as { houseId: string }).houseId;
  if (wheat > 0) {
    const inventory = await db
      .insertInto('game.inventories')
      .values({ world_id: WORLD, house_id: houseId, city_id: cityId, good_id: 'wheat' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('game.stock_ledger')
      .values({
        world_id: WORLD,
        good_id: 'wheat',
        quantity: wheat,
        from_system: 'production',
        to_inventory_id: inventory.id,
        kind: 'test.seed',
      })
      .execute();
  }
  return { user, houseId, cityId };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

const order = (
  player: Player,
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
  key?: string,
) =>
  send(
    player.user,
    'market.placeOrder',
    { cityId: player.cityId, goodId: 'wheat', side, price, quantity },
    key,
  );
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
      select price, quantity from game.order_book() where city_id = ${cityId}`.execute(db);
    expect(book.rows).toEqual([{ price: '20', quantity: '10' }]);
    const events = await db
      .selectFrom('game.domain_events')
      .select('type')
      .where(sql<boolean>`payload->>'cityId' = ${cityId}`)
      .where('type', '=', 'TradeExecuted')
      .execute();
    expect(events).toHaveLength(2);
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
    const seller = await newPlayer(cityId, 30);
    await order(seller, 'sell', 6, 30);
    const buyers = await Promise.all(Array.from({ length: 5 }, () => newPlayer(cityId)));
    const key = randomUUID();
    const results = await Promise.all([
      ...buyers.map((buyer) => order(buyer, 'buy', 6, 10)),
      order(buyers[0] as Player, 'buy', 6, 10, key),
      order(buyers[0] as Player, 'buy', 6, 10, key),
    ]);
    expect(results.every((result) => result.status === 200)).toBe(true);
    const states = await Promise.all(buyers.map(stateOf));
    const boughtUnits = states.reduce((sum, [balance]) => sum + (GRANT - Number(balance)) / 6, 0);
    expect(boughtUnits).toBe(30);
    expect(await stateOf(seller)).toEqual([GRANT + 180, '0/0']);
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
