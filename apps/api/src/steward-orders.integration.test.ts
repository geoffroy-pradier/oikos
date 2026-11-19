import { randomUUID } from 'node:crypto';
import { runStewards } from '@oikos/engine';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { codeOf, db, newWorld, owner, rows, send } from './chat-test-world';
import { TEST_CONFIG } from './test-config';

// Ordres ouverts d'un intendant à ses règles nouvelles et à son renvoi (#562), contre Supabase local : chaque test a
// son monde, dont le carnet n'est partagé avec aucun autre test, et ses maisons fondées par la commande avec un
// moulin, dont l'intrant est le blé.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

type World = Awaited<ReturnType<typeof newWorld>>;
const stewards = TEST_CONFIG.config.stewards;
if (!stewards) throw new Error('the test configuration has no stewards');
let nextIndex = 9_100_000_000 + Math.floor(Math.random() * 1_000_000) * 100;
/** Un tick neuf du monde, deux opérations par intendant. */
const tick = (world: World) => ({
  worldId: world.worldId,
  index: (nextIndex += 1),
  configVersionId: TEST_CONFIG.id,
  config: { ...TEST_CONFIG.config, stewards: { ...stewards, operationsPerTick: 2 } },
});

const holdWheat = { kind: 'sell', goodId: 'wheat', minPriceOboles: 900, keepUnits: 0 } as const;
const buyWheat = (price: number, target: number) =>
  ({ kind: 'buy', goodId: 'wheat', maxPriceOboles: price, targetUnits: target }) as const;

/** Une maison du monde, son moulin, du blé en stock, et l'intendant payé du moulin avec ses règles. */
async function house(world: World, wheat: number, rules: unknown[]) {
  const player = await world.player();
  const mill = await send(player.user, 'site.acquire', { recipeId: 'mill_flour' });
  expect(mill.status).toBe(200);
  await sql`insert into game.inventories (world_id, house_id, city_id, good_id)
    values (${world.worldId}, ${player.houseId}, ${world.kalliste}, 'wheat')`.execute(owner);
  if (wheat > 0)
    await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
      select ${world.worldId}, 'wheat', ${wheat}, 'production', id, 'test.seed' from game.inventories
      where house_id = ${player.houseId} and good_id = 'wheat'`.execute(owner);
  const hired = await send(player.user, 'steward.hire', { siteId: mill.body.data.siteId });
  const steward = hired.body.data.stewardId as string;
  expect(
    codeOf(await send(player.user, 'steward.setRules', { stewardId: steward, rules })),
  ).toEqual([200, undefined]);
  await sql`update game.stewards set unpaid_since = null where id = ${steward}`.execute(owner);
  return { ...player, steward };
}

/** Trésorerie et séquestre d'une maison, en oboles ; blé en stock et réservé. */
async function holdings(houseId: string) {
  const found = await rows(sql<{ kind: string; balance: string }>`
    select kind, balance from game.accounts where house_id = ${houseId}`);
  const of = (kind: string) => Number(found.find((row) => row.kind === kind)?.balance ?? 0);
  const [stock] = await rows(sql<{ quantity: number; reserved: number }>`
    select quantity::int, reserved::int from game.inventories where house_id = ${houseId} and good_id = 'wheat'`);
  return { treasury: of('house'), escrow: of('escrow'), ...stock };
}
/** Ordres de la maison : sens, prix, reste, état, et s'ils sont de l'intendant donné. */
const ordersOf = async (houseId: string, steward: string) =>
  (
    await rows(sql<{
      side: string;
      price: number;
      remaining: number;
      status: string;
      own: boolean;
    }>`
      select side, price::int, remaining::int, status, steward_id is not distinct from ${steward} as own
      from game.orders where house_id = ${houseId} order by seq`)
  ).map((o) => `${o.side} ${o.remaining}@${o.price} ${o.status}${o.own ? ' intendant' : ''}`);
/** Monnaie du monde, comptes système compris, et écritures déséquilibrées : la partie double garde l'une, aucune autre. */
const total = async (world: World) =>
  Number(
    (
      await rows(sql<{ n: string }>`
        select coalesce(sum(balance), 0) as n from game.accounts where world_id = ${world.worldId}`)
    )[0]?.n,
  );
const unbalanced = (world: World) =>
  rows(sql`select e.id from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
    where e.world_id = ${world.worldId} group by e.id having sum(l.amount) <> 0`);

describe('ordres de l’intendant à ses règles nouvelles (#562)', () => {
  it('steward.setRules annule ses ordres ouverts, séquestre rendu par le grand livre, réservation levée', async () => {
    const world = await newWorld();
    const alice = await house(world, 10, [holdWheat, buyWheat(1, 50)]);
    expect(await runStewards(db, tick(world))).toEqual({ acted: 2, refused: 0, failed: 0 });
    // Alice achète elle-même : son ordre n'est pas celui de l'intendant et reste ouvert.
    const own = await send(alice.user, 'market.placeOrder', {
      cityId: world.kalliste,
      goodId: 'wheat',
      side: 'buy',
      price: 1,
      quantity: 3,
    });
    expect(own.status).toBe(200);
    expect(await ordersOf(alice.houseId, alice.steward)).toEqual([
      'sell 10@900 open intendant',
      'buy 40@1 open intendant',
      'buy 3@1 open',
    ]);
    const before = { ...(await holdings(alice.houseId)), total: await total(world) };
    expect(before).toMatchObject({ escrow: 43, quantity: 10, reserved: 10 });

    // Refusées, les règles ne touchent à rien.
    const refused = { kind: 'sell', goodId: 'unobtainium', minPriceOboles: 1, keepUnits: 0 };
    const rejected = await send(alice.user, 'steward.setRules', {
      stewardId: alice.steward,
      rules: [refused],
    });
    expect(codeOf(rejected)).toEqual([404, 'GOOD_NOT_FOUND']);
    expect({ ...(await holdings(alice.houseId)), total: await total(world) }).toEqual(before);
    expect(
      (await ordersOf(alice.houseId, alice.steward)).filter((o) => o.includes('open')),
    ).toHaveLength(3);

    const key = randomUUID();
    const input = { stewardId: alice.steward, rules: [] };
    const reply = await send(alice.user, 'steward.setRules', input, { key });
    expect(codeOf(reply)).toEqual([200, undefined]);
    expect(await ordersOf(alice.houseId, alice.steward)).toEqual([
      'sell 10@900 cancelled intendant',
      'buy 40@1 cancelled intendant',
      'buy 3@1 open',
    ]);
    const after = await holdings(alice.houseId);
    expect(after).toEqual({ treasury: before.treasury + 40, escrow: 3, quantity: 10, reserved: 0 });
    expect(await total(world)).toBe(before.total);
    expect(await unbalanced(world)).toEqual([]);
    // Une écriture de séquestre rendu, marquée de l'intendant ; un événement par ordre, dans la commande.
    expect(
      await rows(sql`select meta from game.ledger_entries
        where world_id = ${world.worldId} and kind = 'market.escrow_release'`),
    ).toEqual([
      { meta: { houseId: alice.houseId, stewardId: alice.steward, cause: 'steward.setRules' } },
    ]);
    expect(
      await rows(sql`select e.type, (e.payload->>'released')::int as released from game.domain_events e
        join game.command_log c on c.id = e.command_id
        where c.user_id = ${alice.user} and c.idempotency_key = ${key} order by e.seq`),
    ).toEqual([
      { type: 'OrderCancelled', released: 10 },
      { type: 'OrderCancelled', released: 40 },
      { type: 'StewardRulesSet', released: null },
    ]);
    // Rejouée, la commande rend sa réponse sans rien rendre deux fois.
    const replayed = await send(alice.user, 'steward.setRules', input, { key });
    expect([replayed.replayed, replayed.body]).toEqual(['true', reply.body]);
    expect(await holdings(alice.houseId)).toEqual(after);
    // Sans règle, l'intendant ne pose plus rien.
    expect(await runStewards(db, tick(world))).toEqual({ acted: 0, refused: 0, failed: 0 });
  });
});

describe('ordres de l’intendant à son renvoi (#562)', () => {
  it('steward.dismiss annule le reste de ses ordres, sans toucher à ce qui a été servi ni aux autres maisons', async () => {
    const world = await newWorld();
    const alice = await house(world, 0, [buyWheat(5, 20)]);
    const bob = await house(world, 8, [buyWheat(2, 13)]);
    expect(await runStewards(db, tick(world))).toEqual({ acted: 2, refused: 0, failed: 0 });
    // Bob vend 8 blés à 5 : l'achat de l'intendant d'Alice est servi en partie, le reste (12) attend.
    const sold = await send(bob.user, 'market.placeOrder', {
      cityId: world.kalliste,
      goodId: 'wheat',
      side: 'sell',
      price: 5,
      quantity: 8,
    });
    expect(sold.body.data).toMatchObject({ status: 'filled', remaining: 0 });
    const before = {
      alice: await holdings(alice.houseId),
      bob: await holdings(bob.houseId),
      total: await total(world),
    };
    expect(before.alice).toMatchObject({ escrow: 60, quantity: 8 });

    const dismissed = await send(alice.user, 'steward.dismiss', { stewardId: alice.steward });
    expect(codeOf(dismissed)).toEqual([200, undefined]);
    expect(await ordersOf(alice.houseId, alice.steward)).toEqual(['buy 12@5 cancelled intendant']);
    expect(await holdings(alice.houseId)).toEqual({
      ...before.alice,
      treasury: before.alice.treasury + 60,
      escrow: 0,
    });
    expect(await ordersOf(bob.houseId, bob.steward)).toEqual([
      'buy 5@2 open intendant',
      'sell 0@5 filled',
    ]);
    expect(await holdings(bob.houseId)).toEqual(before.bob);
    expect(await total(world)).toBe(before.total);
    expect(await unbalanced(world)).toEqual([]);
    // Renvoyé, l'intendant ne pose plus rien ; un second renvoi ne trouve plus l'intendant.
    await runStewards(db, tick(world));
    expect(await ordersOf(alice.houseId, alice.steward)).toEqual(['buy 12@5 cancelled intendant']);
    expect(codeOf(await send(alice.user, 'steward.dismiss', { stewardId: alice.steward }))).toEqual(
      [404, 'STEWARD_NOT_FOUND'],
    );
  });
});

/** Attend que `count` transactions de la base attendent un verrou consultatif. */
async function waiting(count: number) {
  for (let tries = 0; tries < 200; tries += 1) {
    const [found] = await rows(sql<{ n: number }>`select count(*)::int as n from pg_locks
      where locktype = 'advisory' and not granted
        and database = (select oid from pg_database where datname = current_database())`);
    if ((found?.n ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fewer than ${count} transactions wait for an advisory lock`);
}

describe('concurrence avec une opération de l’intendant (#562)', () => {
  it.each([
    ['l’opération passe d’abord : son ordre est annulé par les règles nouvelles', 'engine', 1],
    ['les règles passent d’abord : l’opération les relit et ne pose rien', 'command', 0],
  ] as const)('%s', async (_, first, acted) => {
    const world = await newWorld();
    const alice = await house(world, 0, [buyWheat(3, 10)]);
    const start = await holdings(alice.houseId);
    // Le verrou d'agora du monde, tenu comme par une clôture : l'opération et la commande l'attendent, dans l'ordre.
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let held = () => {};
    const holding = new Promise<void>((resolve) => (held = resolve));
    const holder = owner.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${world.worldId}`}, 0))`.execute(
        trx,
      );
      held();
      await released;
    });
    await holding;
    const engine = () => runStewards(db, tick(world));
    const command = () =>
      send(alice.user, 'steward.setRules', { stewardId: alice.steward, rules: [] });
    const one = first === 'engine' ? engine() : command();
    await waiting(1);
    const two = first === 'engine' ? command() : engine();
    await waiting(2);
    release();
    await holder;
    const [run, reply] = first === 'engine' ? [await one, await two] : [await two, await one];
    expect(run).toMatchObject({ acted, failed: 0 });
    expect(codeOf(reply as Awaited<ReturnType<typeof command>>)).toEqual([200, undefined]);
    expect(await ordersOf(alice.houseId, alice.steward)).toEqual(
      acted ? ['buy 10@3 cancelled intendant'] : [],
    );
    expect(await holdings(alice.houseId)).toEqual(start);
    expect(await unbalanced(world)).toEqual([]);
  });
});
