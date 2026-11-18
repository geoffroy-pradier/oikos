import type { GameConfig } from '@oikos/config';
import { runStewards } from '@oikos/engine';
import { sql } from 'kysely';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { fund } from './property.integration-fixtures';
import {
  balanceOf,
  code,
  db,
  hire,
  newPlayer,
  owner,
  send,
  STEWARDS,
} from './steward.integration-fixtures';
import { TEST_CONFIG } from './test-config';
import { give, WORLD } from './voyage.integration-fixtures';

// Exécution des règles des intendants par le moteur (#279), contre Supabase local. Chaque test fonde ses maisons :
// un champ de blé (40 blés par cycle de 240 minutes) et un moulin, dont l'intrant est le blé.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
// Un intendant mène ses règles à chaque tick, y compris ceux des tests suivants : chaque test renvoie les siens.
const hired: { user: string; id: string }[] = [];
afterEach(async () => {
  for (const { user, id } of hired.splice(0))
    expect(code(await send(user, 'steward.dismiss', { stewardId: id }))).toBe('ok');
});

const WHEAT_CYCLE_MS = 240 * 60_000;
/** Un tick du monde de test, sous la configuration de test modifiée par `change` ; chaque appel en ouvre un neuf. */
let nextIndex = 9_000_000_000 + Math.floor(Math.random() * 1_000_000) * 100;
const tick = (change: (stewards: typeof STEWARDS) => Partial<typeof STEWARDS> = () => ({})) => {
  const stewards = { ...STEWARDS, ...change(STEWARDS) };
  const config: GameConfig = { ...TEST_CONFIG.config, stewards };
  nextIndex += 1;
  return { worldId: WORLD, index: nextIndex, configVersionId: TEST_CONFIG.id, config };
};

/** Fait vieillir le cycle en cours du site : la garde de la base interdit l'antidatage, levée le temps du test. */
async function age(siteId: string, cycles: number) {
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = created_at - ${`${cycles * WHEAT_CYCLE_MS} milliseconds`}::interval,
      cycle_started_at = cycle_started_at - ${`${cycles * WHEAT_CYCLE_MS} milliseconds`}::interval
      where id = ${siteId}`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}
/** L'intendant du site, avec ses règles, payé comme par une clôture. */
async function steward(user: string, siteId: string, rules: unknown[]) {
  const id = await hire(user, siteId);
  expect(code(await send(user, 'steward.setRules', { stewardId: id, rules }))).toBe('ok');
  await sql`update game.stewards set unpaid_since = null where id = ${id}`.execute(owner);
  hired.push({ user, id });
  return id;
}
const operationsOf = (stewardId: string) =>
  db
    .selectFrom('game.steward_operations')
    .select([
      'tick_index',
      'rank',
      'rule_position',
      'status',
      'error_code',
      'summary',
      'command_id',
    ])
    .where('steward_id', '=', stewardId)
    .orderBy('tick_index')
    .orderBy('rank')
    .execute();
const logOf = (commandId: string) =>
  db
    .selectFrom('game.command_log')
    .select([
      'user_id',
      'command',
      'idempotency_key',
      'status',
      'error_code',
      'steward_id',
      'input',
    ])
    .where('id', '=', commandId)
    .executeTakeFirstOrThrow();
const eventTypes = async (commandId: string) =>
  (
    await db
      .selectFrom('game.domain_events')
      .select('type')
      .where('command_id', '=', commandId)
      .orderBy('seq')
      .execute()
  ).map((event) => event.type);
const stock = async (houseId: string, goodId: string) => {
  const row = await db
    .selectFrom('game.inventories')
    .select(['quantity', 'reserved'])
    .where('house_id', '=', houseId)
    .where('good_id', '=', goodId)
    .executeTakeFirst();
  return { quantity: Number(row?.quantity ?? 0), reserved: Number(row?.reserved ?? 0) };
};
const collect = { kind: 'collect' } as const;
/** Vend tout le blé libre, à une obole ou plus : le carnet est partagé avec les autres tests. */
const sellWheat = { kind: 'sell', goodId: 'wheat', minPriceOboles: 1, keepUnits: 0 } as const;
/** Vend tout le blé libre à un prix qu'aucun acheteur ne paie : l'ordre attend. */
const holdWheat = { ...sellWheat, minPriceOboles: 900 } as const;

describe('opérations des intendants', () => {
  it('récolte puis vend, une opération par tick, dans l’ordre de ses règles ; rejouer un tick ne double rien', async () => {
    const player = await newPlayer();
    const buyer = await newPlayer();
    const id = await steward(player.user, player.field, [collect, sellWheat]);
    const before = await stock(player.houseId, 'wheat');
    await age(player.field, 2);

    const first = tick();
    await runStewards(db, first);
    // Deux moteurs, ou le même au passage suivant : le tick est déjà mené.
    await runStewards(db, first);
    const [collected] = await operationsOf(id);
    expect(await operationsOf(id)).toHaveLength(1);
    expect(collected).toMatchObject({
      tick_index: String(first.index),
      rank: 0,
      rule_position: 0,
      status: 'ok',
    });
    expect(collected?.summary).toEqual({
      command: 'site.collect',
      cycles: 2,
      outputs: [{ goodId: 'wheat', quantity: 80 }],
    });
    expect((await stock(player.houseId, 'wheat')).quantity).toBe(before.quantity + 80);
    // Au journal des commandes au nom de la maison, avec l'intendant pour acteur ; les événements du joueur.
    const log = await logOf(collected?.command_id ?? '');
    expect(log).toMatchObject({
      user_id: player.user,
      command: 'site.collect',
      idempotency_key: `steward:${id}:${first.index}:0`,
      status: 'ok',
      steward_id: id,
      input: { siteId: player.field },
    });
    expect(await eventTypes(collected?.command_id ?? '')).toEqual(['SiteCollected']);

    // Un acheteur attend plus de blé que le champ n'en a, à une obole ; le champ a de nouveau deux cycles à
    // récolter, mais la file passe à la vente, servie en entier, du plus offrant au moins offrant.
    const free = before.quantity - before.reserved + 80;
    const cityId = await cityOf(player.field);
    const bid = { cityId, goodId: 'wheat', side: 'buy', price: 1, quantity: free + 10 };
    const placed = await send(buyer.user, 'market.placeOrder', bid);
    expect(placed.body.data).toMatchObject({ status: 'open', trades: [] });
    await age(player.field, 2);
    const treasury = await balanceOf({ houseId: player.houseId });
    await runStewards(db, tick());
    const sold = (await operationsOf(id))[1];
    expect(sold).toMatchObject({ rank: 0, rule_position: 1, status: 'ok' });
    expect(sold?.summary).toEqual({
      command: 'market.placeOrder',
      side: 'sell',
      goodId: 'wheat',
      price: 1,
      quantity: free,
      traded: free,
      status: 'filled',
    });
    const events = await eventTypes(sold?.command_id ?? '');
    expect(events[0]).toBe('OrderPlaced');
    expect(events.length).toBeGreaterThan(1);
    expect(events.slice(1).every((type) => type === 'TradeExecuted')).toBe(true);
    // Tout le stock libre a quitté l'entrepôt, par le journal des stocks ; rien n'attend au carnet.
    expect(await stock(player.houseId, 'wheat')).toEqual({
      quantity: before.reserved,
      reserved: before.reserved,
    });
    // Payé au prix de chaque acheteur servi, moins la taxe de la cité : ni plus que le brut, ni rien sans échange.
    const gained = (await balanceOf({ houseId: player.houseId })) - treasury;
    const gross = await db
      .selectFrom('game.trades')
      .innerJoin('game.domain_events as e', (join) =>
        join
          .on('e.command_id', '=', sold?.command_id ?? '')
          .on(sql<boolean>`(e.payload->>'tradeId')::uuid = game.trades.id`),
      )
      .select(sql<string>`sum(game.trades.price * game.trades.quantity)`.as('oboles'))
      .executeTakeFirstOrThrow();
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThanOrEqual(Number(gross.oboles));
    // Le carnet reste propre pour les autres tests : l'acheteur retire le reste de son ordre.
    const orderId = placed.body.data.orderId as string;
    expect(code(await send(buyer.user, 'market.cancelOrder', { orderId }))).toBe('ok');

    // Le tick suivant reprend à la récolte.
    await runStewards(db, tick());
    expect((await operationsOf(id)).map((op) => op.rule_position)).toEqual([0, 1, 0]);
  });

  it('refus faute de trésorerie : noté, sans effet, sans retenir les autres intendants ni ses règles suivantes', async () => {
    const [alice, bob] = [await newPlayer(), await newPlayer()];
    const buyWheat = {
      kind: 'buy',
      goodId: 'wheat',
      maxPriceOboles: 7,
      targetUnits: 5_000,
    } as const;
    const aliceId = await steward(alice.user, alice.mill, [
      buyWheat,
      { kind: 'sell', goodId: 'flour', minPriceOboles: 9, keepUnits: 0 },
    ]);
    const bobId = await steward(bob.user, bob.field, [collect]);
    await fund(alice.houseId, -(await balanceOf({ houseId: alice.houseId })));
    await age(bob.field, 1);
    const orders = () =>
      db.selectFrom('game.orders').select('id').where('house_id', '=', alice.houseId).execute();

    const run = await runStewards(db, tick());
    expect(run.failed).toBe(0);
    const [refused] = await operationsOf(aliceId);
    expect(refused).toMatchObject({
      rule_position: 0,
      status: 'rejected',
      error_code: 'INSUFFICIENT_FUNDS',
    });
    expect(refused?.summary).toEqual({
      command: 'market.placeOrder',
      side: 'buy',
      goodId: 'wheat',
      price: 7,
      quantity: 5_000,
    });
    expect(await logOf(refused?.command_id ?? '')).toMatchObject({
      status: 'rejected',
      error_code: 'INSUFFICIENT_FUNDS',
      steward_id: aliceId,
    });
    const failed = await db
      .selectFrom('game.domain_events')
      .select(['type', 'payload'])
      .where('command_id', '=', refused?.command_id ?? '')
      .execute();
    expect(failed).toEqual([
      {
        type: 'StewardActionFailed',
        payload: {
          stewardId: aliceId,
          houseId: alice.houseId,
          siteId: alice.mill,
          tickIndex: Number(refused?.tick_index),
          rank: 0,
          rule: buyWheat,
          command: 'market.placeOrder',
          code: 'INSUFFICIENT_FUNDS',
        },
      },
    ]);
    expect(await orders()).toEqual([]);
    expect(await balanceOf({ houseId: alice.houseId })).toBe(0);
    expect((await operationsOf(bobId)).map((op) => op.status)).toEqual(['ok']);
    // Le refus ne retient pas la règle suivante : faute de farine, elle n'a rien à faire, et la file revient au rachat.
    await runStewards(db, tick());
    expect((await operationsOf(aliceId)).map((op) => [op.rule_position, op.error_code])).toEqual([
      [0, 'INSUFFICIENT_FUNDS'],
      [0, 'INSUFFICIENT_FUNDS'],
    ]);
  });

  it('inactif impayé ; une configuration qui réduit les règles ne mène que les premières ; plusieurs opérations par tick', async () => {
    const player = await newPlayer();
    const id = await steward(player.user, player.field, [collect, holdWheat]);
    await give(player.houseId, 'wheat', 10, await cityOf(player.field));
    await sql`update game.stewards set unpaid_since = now() where id = ${id}`.execute(owner);
    await runStewards(db, tick());
    expect(await operationsOf(id)).toEqual([]);
    await sql`update game.stewards set unpaid_since = null where id = ${id}`.execute(owner);
    // Une seule règle admise : la récolte n'a rien à faire, et la vente du blé n'est pas menée.
    await runStewards(
      db,
      tick(() => ({ rulesPerSteward: 1 })),
    );
    expect(await operationsOf(id)).toEqual([]);
    await runStewards(db, tick());
    expect((await operationsOf(id)).map((op) => [op.rank, op.rule_position])).toEqual([[0, 1]]);
    // Deux opérations par tick : la récolte, puis la vente de ce qu'elle a produit, sous deux rangs.
    await age(player.field, 1);
    const both = tick(() => ({ operationsPerTick: 2 }));
    await runStewards(db, both);
    const ops = await operationsOf(id);
    expect(ops.map((op) => [op.rank, op.rule_position, op.status])).toEqual([
      [0, 1, 'ok'],
      [0, 0, 'ok'],
      [1, 1, 'ok'],
    ]);
    expect(ops[2]?.summary).toMatchObject({ side: 'sell', quantity: 40, status: 'open' });
  });

  it('deux moteurs concurrents : chaque opération une fois, chaque récolte une fois', async () => {
    const players = await Promise.all([newPlayer(), newPlayer(), newPlayer()]);
    const ids = [];
    for (const player of players) {
      ids.push(await steward(player.user, player.field, [collect]));
      await age(player.field, 1);
    }
    const before = await Promise.all(players.map((player) => stock(player.houseId, 'wheat')));
    const shared = tick(() => ({ operationsPerTick: 2 }));
    const runs = await Promise.all([
      runStewards(db, shared),
      runStewards(db, shared),
      runStewards(db, shared),
    ]);
    expect(runs.map((run) => run.failed)).toEqual([0, 0, 0]);
    for (const [index, player] of players.entries()) {
      expect((await operationsOf(ids[index] ?? '')).map((op) => op.rank)).toEqual([0]);
      expect((await stock(player.houseId, 'wheat')).quantity).toBe(
        (before[index]?.quantity ?? 0) + 40,
      );
      const keys = await db
        .selectFrom('game.command_log')
        .select('idempotency_key')
        .where('steward_id', '=', ids[index] ?? '')
        .execute();
      expect(keys).toEqual([{ idempotency_key: `steward:${ids[index]}:${shared.index}:0` }]);
    }
  });

  it('la maison agit pendant que son intendant agit : ni interblocage, ni double récolte, ni vente au-delà du stock', async () => {
    for (let round = 0; round < 3; round += 1) {
      const player = await newPlayer();
      const id = await steward(player.user, player.field, [collect, holdWheat]);
      await age(player.field, 3);
      const before = await stock(player.houseId, 'wheat');
      const cityId = await cityOf(player.field);
      const [run, collected, sold, bought] = await Promise.all([
        runStewards(
          db,
          tick(() => ({ operationsPerTick: 2 })),
        ),
        send(player.user, 'site.collect', { siteId: player.field }),
        send(player.user, 'market.placeOrder', {
          cityId,
          goodId: 'wheat',
          side: 'sell',
          price: 950,
          quantity: 10,
        }),
        send(player.user, 'market.placeOrder', {
          cityId,
          goodId: 'flour',
          side: 'buy',
          price: 1,
          quantity: 1,
        }),
      ]);
      expect(run.failed).toBe(0);
      for (const reply of [collected, sold, bought])
        expect(reply.body.error?.code).not.toBe('INTERNAL');
      const after = await stock(player.houseId, 'wheat');
      // Trois cycles récoltés une seule fois, par le joueur ou par l'intendant ; rien n'est vendu au-delà du stock.
      expect(after.quantity).toBe(before.quantity + 120);
      expect(after.reserved).toBeLessThanOrEqual(after.quantity);
      const ops = await operationsOf(id);
      const collects = ops.filter((op) => op.rule_position === 0 && op.status === 'ok').length;
      expect(collects + (collected.body.ok ? 1 : 0)).toBe(1);
    }
  });

  it('clôture pendant que l’intendant agit : il attend la clôture au lieu de s’interbloquer avec elle', async () => {
    const player = await newPlayer();
    const id = await steward(player.user, player.field, [collect]);
    await age(player.field, 1);
    const before = await stock(player.houseId, 'wheat');
    // La clôture (`siteUpkeep`) prend l'agora, la trésorerie, les sites de la maison, puis ses intendants.
    const close = await owner.startTransaction().execute();
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${WORLD}`}, 0))`.execute(
      close,
    );
    await sql`select 1 from game.accounts where house_id = ${player.houseId} and kind = 'house' for update`.execute(
      close,
    );
    await sql`select 1 from game.sites where house_id = ${player.houseId} for update`.execute(
      close,
    );
    const running = runStewards(db, tick());
    await new Promise((resolve) => setTimeout(resolve, 300));
    await sql`select 1 from game.stewards where id = ${id} for update`.execute(close);
    await close.commit().execute();
    const run = await running;
    expect(run.failed).toBe(0);
    expect((await operationsOf(id)).map((op) => op.status)).toEqual(['ok']);
    expect((await stock(player.houseId, 'wheat')).quantity).toBe(before.quantity + 40);
  });

  it('la clé d’une opération est hors de portée du joueur : l’API la refuse, l’intendant la prend', async () => {
    const player = await newPlayer();
    const id = await steward(player.user, player.field, [collect]);
    await age(player.field, 1);
    const next = tick();
    const key = `steward:${id}:${next.index}:0`;
    const reply = await send(player.user, 'site.collect', { siteId: player.field }, key);
    expect(reply.body.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    await runStewards(db, next);
    const { rows } = await sql`select steward_id, status from game.command_log
      where user_id = ${player.user} and idempotency_key = ${key}`.execute(db);
    expect(rows).toEqual([{ steward_id: id, status: 'ok' }]);
  });
});

const cityOf = async (siteId: string) =>
  (
    await db
      .selectFrom('game.sites')
      .select('city_id')
      .where('id', '=', siteId)
      .executeTakeFirstOrThrow()
  ).city_id;
