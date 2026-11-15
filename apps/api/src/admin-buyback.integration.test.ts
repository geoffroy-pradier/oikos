import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { buybackPreviewSchema, type BuybackTotals } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { farCloseClock, TEST_CONFIG, testVerifier } from './test-config';

// Rachat du stock d'un bien à retirer (#229), contre Supabase local. Le bien est propre à cette
// exécution : le rachat, comme le contrôle de #191, porte sur tous les mondes de la base partagée.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const RELIC = `relic_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
const PRICE = 40;
const clock = farCloseClock(new Date());
const SAME_CLOCK = { ...TEST_CONFIG.config, clock };
const WITH_RELIC = {
  ...SAME_CLOCK,
  goods: [
    ...SAME_CLOCK.goods,
    { id: RELIC, tier: 'finished' as const, referencePriceOboles: PRICE, elasticity: 1 },
  ],
};
// La configuration en vigueur connaît le bien : c'est elle qui donne son prix de référence.
const app = createApp({
  db,
  telemetry: createTelemetry(db),
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: async () => ({ ...TEST_CONFIG, config: WITH_RELIC }),
});

const send = async (
  user: string,
  command: string,
  body: unknown,
  { aal2 = true, key = randomUUID() as string } = {},
) => {
  const res = await app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${aal2 ? 'aal2:' : ''}${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as { data?: Record<string, unknown>; error?: { code: string } },
  };
};
async function newUser(
  role?: 'super_admin' | 'game_designer',
  grantedBy: string | null = null,
): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  if (role)
    await owner
      .insertInto('admin.roles')
      .values({ user_id: id, role, granted_by: grantedBy })
      .execute();
  return id;
}
/** Totaux qu'Olympe montre sous le bien, lus comme l'écran les lit. */
const preview = async () => {
  const res = await app.request('/api/admin/config/versions', {
    headers: { authorization: `Bearer aal2:${root}` },
  });
  const listing = (await res.json()) as { data: { buybacks: unknown[] } };
  const found = listing.data.buybacks
    .map((entry) => buybackPreviewSchema.parse(entry))
    .find((entry) => entry.goodId === RELIC);
  return found ?? null;
};
/** Totaux montrés, le bien encore détenu. */
const totals = async () => {
  const shown = await preview();
  if (!shown) throw new Error(`${RELIC} is not held`);
  return shown.totals;
};
/** Départ propre : ce que les tests précédents laissent du bien est racheté. */
const clear = async () => {
  const left = await preview();
  if (left) expect((await buyBack(left.totals)).status).toBe(200);
};
const buyBack = (
  expected: BuybackTotals,
  options?: { aal2?: boolean; key?: string },
  user = root,
) => send(user, 'admin.buyBackGood', { goodId: RELIC, expected }, options);

let root: string;
let designer: string;
const worlds = [randomUUID(), randomUUID()];
const cities = [randomUUID(), randomUUID(), randomUUID()];
const worldOfCity = [worlds[0], worlds[0], worlds[1]];
const scheduled: string[] = [];
beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  root = await newUser('super_admin');
  designer = await newUser('game_designer', root);
  for (const world of worlds)
    await sql`insert into game.worlds (id, slug, name) values (${world}, ${`b-${world.slice(0, 12)}`}, 'Rachat')`.execute(
      owner,
    );
  for (const [index, city] of cities.entries())
    await sql`insert into game.cities (id, world_id, slug, name) values (${city}, ${worldOfCity[index]}, ${`c-${city.slice(0, 8)}`}, 'Agora')`.execute(
      owner,
    );
});
afterAll(async () => {
  // Rien du bien ne reste détenu, sinon plus aucune version sans lui ne se programmerait ; les
  // programmations de ce fichier (horloge de test) sont annulées avant leur échéance.
  await clear();
  for (const versionId of scheduled) {
    const pending = await db
      .selectFrom('config.activations as a')
      .leftJoin('config.activation_cancellations as c', 'c.activation_id', 'a.id')
      .select('a.id')
      .where('a.version_id', '=', versionId)
      .where('c.activation_id', 'is', null)
      .where('a.activate_at', '>', new Date())
      .executeTakeFirst();
    if (pending) await send(root, 'admin.cancelActivation', { activationId: pending.id });
  }
  await Promise.all([db.destroy(), owner.destroy()]);
});

/** Une maison dans la cité `home`, avec son stock du bien par cité. */
const house = async (home: number, stock: Record<number, number> = {}) => {
  const user = await newUser();
  const founded = await send(
    user,
    'house.create',
    {
      cityId: cities[home],
      name: `Maison ${randomUUID()
        .replace(/[^a-f]/g, '')
        .slice(0, 8)}`,
      blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
    },
    { aal2: false },
  );
  const houseId = String(founded.body.data?.['houseId']);
  for (const [city, quantity] of Object.entries(stock))
    await harvest(houseId, Number(city), quantity);
  return { user, houseId, home };
};
/** Récolte simulée : la production remplit le stock de la maison dans la cité, par le journal. */
const harvest = async (houseId: string, city: number, quantity: number) => {
  const world_id = worldOfCity[city] ?? '';
  await db
    .insertInto('game.inventories')
    .values({ world_id, house_id: houseId, city_id: cities[city] ?? '', good_id: RELIC })
    .onConflict((conflict) => conflict.constraint('inventories_unique').doNothing())
    .execute();
  const { id } = await db
    .selectFrom('game.inventories')
    .select('id')
    .where('house_id', '=', houseId)
    .where('city_id', '=', cities[city] ?? '')
    .where('good_id', '=', RELIC)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('game.stock_ledger')
    .values({
      world_id,
      good_id: RELIC,
      quantity,
      from_system: 'production',
      to_inventory_id: id,
      kind: 'test.relic',
    })
    .execute();
};
const order = (
  who: { user: string },
  city: number,
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
) =>
  send(
    who.user,
    'market.placeOrder',
    { cityId: cities[city], goodId: RELIC, side, price, quantity },
    { aal2: false },
  );

/**
 * Quatre maisons, deux mondes, trois cités. A : 10 + 3 unités dans deux cités, vend 4 (réservées).
 * B : 6 unités, achète 5 à 9 (séquestre 45). C, autre monde : 5 unités, vend 2. D : achète 3 à 7
 * (séquestre 21) sans aucun stock. Aucun ordre ne se croise.
 */
const scenario = async () => {
  const a = await house(0, { 0: 10, 1: 3 });
  const b = await house(0, { 0: 6 });
  const c = await house(2, { 2: 5 });
  const d = await house(1);
  for (const placed of [
    await order(a, 0, 'sell', 50, 4),
    await order(b, 0, 'buy', 9, 5),
    await order(c, 2, 'sell', 60, 2),
    await order(d, 1, 'buy', 7, 3),
  ])
    expect(placed.status).toBe(200);
  return { a, b, c, d };
};
interface AuditEntry {
  userId: string;
  command: string;
  status: string;
  result: { houses: { houseId: string; worldId: string }[] };
}
const EXPECTED = { houses: 4, units: 24, cancelledOrders: 4, oboles: 24 * PRICE };

/** État du bien et de la monnaie, par monde : ce que la conservation compare avant et après. */
const snapshot = async () => {
  const rows = await sql<Record<'faucet' | 'supply' | 'held' | 'reserved' | 'retired', string>>`
    select
      (select sum(balance) from game.accounts where world_id = w.id and system_key = 'faucet_good_buyback') as faucet,
      (select sum(balance) from game.accounts where world_id = w.id and kind <> 'system') as supply,
      (select coalesce(sum(quantity), 0) from game.inventories where world_id = w.id and good_id = ${RELIC}) as held,
      (select coalesce(sum(reserved), 0) from game.inventories where world_id = w.id and good_id = ${RELIC}) as reserved,
      (select coalesce(sum(quantity), 0) from game.stock_ledger
       where world_id = w.id and good_id = ${RELIC} and to_system = 'good_buyback') as retired
    from unnest(${worlds}::uuid[]) with ordinality as w (id, rank) order by rank`.execute(db);
  const [first, second] = rows.rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])),
  ) as Record<'faucet' | 'supply' | 'held' | 'reserved' | 'retired', number>[];
  if (!first || !second) throw new Error('Test worlds are missing');
  return [first, second] as const;
};
const treasuries = async (houseId: string) =>
  Object.fromEntries(
    (
      await db
        .selectFrom('game.accounts')
        .select(['kind', 'balance'])
        .where('house_id', '=', houseId)
        .execute()
    ).map((account) => [account.kind, Number(account.balance)]),
  );

describe('admin.buyBackGood (#229)', () => {
  it('refuse tout autre compte que le super-administrateur à double authentification, sans rien faire', async () => {
    await scenario();
    const before = await snapshot();
    expect(await preview()).toEqual({ goodId: RELIC, unitPriceOboles: PRICE, totals: EXPECTED });
    for (const refused of [
      await buyBack(EXPECTED, {}, designer),
      await buyBack(EXPECTED, { aal2: false }),
      await buyBack(EXPECTED, {}, await newUser()),
    ])
      expect(refused).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
    expect(await snapshot()).toEqual(before);
    expect((await preview())?.totals).toEqual(EXPECTED);
  });

  it('refuse des totaux qui ne sont plus ceux montrés, et un bien inconnu de la configuration en vigueur', async () => {
    const before = await snapshot();
    for (const key of ['houses', 'units', 'cancelledOrders', 'oboles'] as const)
      expect(await buyBack({ ...EXPECTED, [key]: EXPECTED[key] + 1 })).toMatchObject({
        status: 409,
        body: { error: { code: 'BUYBACK_CHANGED' } },
      });
    const unknown = await send(root, 'admin.buyBackGood', {
      goodId: 'unobtainium',
      expected: EXPECTED,
    });
    expect(unknown).toMatchObject({ status: 404, body: { error: { code: 'GOOD_NOT_FOUND' } } });
    expect(await snapshot()).toEqual(before);
  });

  it('une récolte ou un ordre entre la lecture et l’envoi fait refuser ; rien n’est racheté', async () => {
    const changed = { status: 409, body: { error: { code: 'BUYBACK_CHANGED' } } };
    const shown = await totals();
    const someone = await house(0);
    await harvest(someone.houseId, 0, 1);
    expect(await buyBack(shown)).toMatchObject(changed);
    const reread = await totals();
    expect(reread).toEqual({
      ...shown,
      houses: shown.houses + 1,
      units: shown.units + 1,
      oboles: shown.oboles + PRICE,
    });
    expect((await order(someone, 0, 'buy', 5, 2)).status).toBe(200);
    expect(await buyBack(reread)).toMatchObject(changed);
    expect(await totals()).toEqual({ ...reread, cancelledOrders: reread.cancelledOrders + 1 });
  });

  it('rachète tout, conserve monnaie et stocks, rejoue sans racheter deux fois ; la version qui retire le bien se programme (#191)', async () => {
    await clear();
    const { a, b, c, d } = await scenario();
    const without = String(
      (await send(designer, 'admin.publishConfig', { config: SAME_CLOCK })).body.data?.[
        'versionId'
      ],
    );
    const schedule = () =>
      send(root, 'admin.scheduleConfig', { versionId: without, confirmRetiredInUse: true });
    expect(await schedule()).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFIG_GOOD_IN_USE' } },
    });

    const grant = (await treasuries(a.houseId))['house'] ?? 0;
    const before = await snapshot();
    expect(before[0]).toMatchObject({ held: 19, reserved: 4 });
    expect(before[1]).toMatchObject({ held: 5, reserved: 2 });
    const key = randomUUID();
    const done = await buyBack(EXPECTED, { key });
    expect(done).toMatchObject({
      status: 200,
      body: { data: { goodId: RELIC, unitPriceOboles: PRICE, totals: EXPECTED } },
    });
    const after = await snapshot();
    // Monnaie : le robinet de chaque monde porte exactement ce qu'il a créé, la masse grandit d'autant.
    expect(after[0].faucet - before[0].faucet).toBe(-19 * PRICE);
    expect(after[1].faucet - before[1].faucet).toBe(-5 * PRICE);
    for (const world of [0, 1] as const) {
      expect(after[world].supply - before[world].supply).toBe(
        before[world].faucet - after[world].faucet,
      );
      // Stock : tout le détenu, réservé compris, est passé au rachat ; rien d'autre.
      expect(after[world]).toMatchObject({ held: 0, reserved: 0 });
      expect(after[world].retired - before[world].retired).toBe(before[world].held);
    }
    // Chaque maison : son stock au prix de référence, son séquestre rendu, plus rien de retenu.
    expect(await treasuries(a.houseId)).toEqual({ house: grant + 13 * PRICE });
    expect(await treasuries(b.houseId)).toEqual({ house: grant + 6 * PRICE, escrow: 0 });
    expect(await treasuries(c.houseId)).toEqual({ house: grant + 5 * PRICE });
    expect(await treasuries(d.houseId)).toEqual({ house: grant, escrow: 0 });
    const checks = await sql<{ bad: string }>`
      select (select count(*) from game.account_balance_check where world_id = any(${worlds}::uuid[]) and not ok)
           + (select count(*) from game.inventory_quantity_check where world_id = any(${worlds}::uuid[]) and not ok) as bad`.execute(
      db,
    );
    expect(Number(checks.rows[0]?.bad)).toBe(0);
    // Journal d'audit, lu comme Olympe le lit : chaque maison y est nommée, une seule fois, avec son monde.
    const audit = await app.request('/api/admin/audit?limit=100', {
      headers: { authorization: `Bearer aal2:${root}` },
    });
    const { entries } = ((await audit.json()) as { data: { entries: AuditEntry[] } }).data;
    const logged = entries.find(
      (e) => e.userId === root && e.command === 'admin.buyBackGood' && e.status === 'ok',
    );
    expect(logged?.result.houses.map((h) => `${h.houseId}:${h.worldId}`).sort()).toEqual(
      [a, b, c, d].map((h) => `${h.houseId}:${worldOfCity[h.home]}`).sort(),
    );
    const events = await sql<{ type: string; payload: Record<string, unknown> }>`
      select e.type, e.payload from game.domain_events e join game.command_log l on l.id = e.command_id
      where l.user_id = ${root} and l.idempotency_key = ${key} order by e.seq`.execute(db);
    expect(events.rows.filter((e) => e.type === 'OrderCancelled')).toHaveLength(4);
    const bought = events.rows.filter((e) => e.type === 'GoodBoughtBack').map((e) => e.payload);
    expect(bought).toHaveLength(4);
    expect(bought.find((p) => p['houseId'] === d.houseId)).toMatchObject({
      units: 0,
      oboles: 0,
      cancelledOrders: 1,
    });
    expect(bought.find((p) => p['houseId'] === a.houseId)).toMatchObject({
      goodId: RELIC,
      units: 13,
      oboles: 13 * PRICE,
      unitPriceOboles: PRICE,
      cancelledOrders: 1,
      boughtBackBy: root,
    });

    // Rejouer : même réponse, rien de plus ; une clé neuve trouve l'état changé.
    const replay = await buyBack(EXPECTED, { key });
    expect(replay).toEqual(done);
    expect(await buyBack(EXPECTED)).toMatchObject({ body: { error: { code: 'BUYBACK_CHANGED' } } });
    expect(await snapshot()).toEqual(after);
    // Plus rien du bien n'est détenu : Olympe ne propose plus de rachat, la version se programme.
    expect(await preview()).toBeNull();
    const programmed = await schedule();
    expect(programmed.status).toBe(200);
    scheduled.push(without);
  });

  it('concurrence : deux rachats simultanés, un seul passe ; une vente simultanée passe avant ou échoue', async () => {
    await clear();
    const { a } = await scenario();
    const before = await snapshot();
    const results = await Promise.all([buyBack(EXPECTED), buyBack(EXPECTED)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const after = await snapshot();
    expect(after[0].faucet - before[0].faucet).toBe(-19 * PRICE);
    expect(after[1].faucet - before[1].faucet).toBe(-5 * PRICE);

    await harvest(a.houseId, 0, 8);
    const shown = (await preview())?.totals ?? EXPECTED;
    const [sold, bought] = await Promise.all([order(a, 0, 'sell', 90, 8), buyBack(shown)]);
    if (bought.status === 200) {
      expect(sold).toMatchObject({ status: 409, body: { error: { code: 'INSUFFICIENT_STOCK' } } });
      expect(await preview()).toBeNull();
    } else {
      expect(sold.status).toBe(200);
      expect(bought).toMatchObject({ body: { error: { code: 'BUYBACK_CHANGED' } } });
      expect((await preview())?.totals).toEqual({ ...shown, cancelledOrders: 1 });
    }
  });
});
