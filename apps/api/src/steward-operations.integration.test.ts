import { randomUUID } from 'node:crypto';
import { INITIAL_CONFIG, publishVersion, type GameConfig } from '@oikos/config';
import { runAllStewards, runStewards } from '@oikos/engine';
import { createDb } from '@oikos/db';
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

  it('compte exclu pendant que l’intendant attend l’agora : relu sous ce verrou, il ne place plus d’ordre (#528)', async () => {
    const player = await newPlayer();
    const id = await steward(player.user, player.field, [holdWheat]);
    // Le compte exclu ne renvoie plus son intendant (`SUSPENDED`) : exclu, il n'est plus mené à aucun tick.
    hired.splice(
      hired.findIndex((entry) => entry.id === id),
      1,
    );
    await give(player.houseId, 'wheat', 10, await cityOf(player.field));
    // Une exclusion validée entre-temps, comme par `admin.confirmExclusion` (qui annule alors les ordres du compte).
    const [author, validator] = [await account(), await account()];
    const running = whileAgoraHeld(() => pronounce(player.user, 'ban', 0, null, author, validator));
    expect((await running).failed).toBe(0);
    expect(await operationsOf(id)).toEqual([]);
    expect(await stock(player.houseId, 'wheat')).toEqual({ quantity: 10, reserved: 0 });
    const orders = await sql<{ n: number }>`
      select count(*)::int as n from game.orders where house_id = ${player.houseId}`.execute(owner);
    expect(orders.rows).toEqual([{ n: 0 }]);
  });

  it('compte suspendu pendant que l’intendant attend : la condition du registre, relue dans sa transaction, arrête aussi une récolte (#563)', async () => {
    const player = await newPlayer();
    const id = await steward(player.user, player.field, [collect]);
    await age(player.field, 1);
    const before = await stock(player.houseId, 'wheat');
    const author = await account();
    let suspension = '';
    const run = await whileAgoraHeld(async () => {
      suspension = await pronounce(player.user, 'suspension', 0, 3600, author);
    });
    expect(run).toEqual({ acted: 0, refused: 0, failed: 0 });
    expect(await operationsOf(id)).toEqual([]);
    expect(await stock(player.houseId, 'wheat')).toEqual(before);
    // Levée, la sanction cesse d'agir dès l'opération suivante ; le joueur peut alors renvoyer son intendant.
    await lift(suspension, author);
    await runStewards(db, tick());
    expect((await operationsOf(id)).map((op) => op.status)).toEqual(['ok']);
  });

  it('une même condition décide pour la commande du joueur et pour son intendant (#563)', async () => {
    const author = await account();
    /** Verdict de l'API pour une commande de jeu et pour une parole (`house.rename`), et opérations de l'intendant. */
    const verdict = async (player: Awaited<ReturnType<typeof newPlayer>>, stewardId: string) => {
      const collected = code(await send(player.user, 'site.collect', { siteId: player.mill }));
      const letters = [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');
      const renamed = code(
        await send(player.user, 'house.rename', { name: `Sanction ${letters}` }),
      );
      await age(player.field, 1);
      await runStewards(db, tick());
      const operations = (await operationsOf(stewardId)).length;
      return {
        game: collected === 'SUSPENDED' ? 'SUSPENDED' : 'free',
        speech: renamed,
        operations,
      };
    };
    const cases = [
      // Un silence ne retire que la parole : l'intendant agit.
      { sanctions: [['silence', -60, 3600]], expected: { game: 'free', speech: 'SILENCED' } },
      // Exclusion proposée, avertissement, suspensions finie et à venir : rien n'arrête personne.
      {
        sanctions: [
          ['ban', 0, null],
          ['warning', 0, 3600],
          ['suspension', -7200, -3600],
          ['suspension', 3600, 7200],
        ],
        expected: { game: 'free', speech: 'ok' },
      },
      {
        sanctions: [['suspension', -1, 3600]],
        expected: { game: 'SUSPENDED', speech: 'SUSPENDED' },
      },
    ] as const;
    for (const { sanctions, expected } of cases) {
      const player = await newPlayer();
      const id = await steward(player.user, player.field, [collect]);
      const pronounced: string[] = [];
      for (const [kind, from, to] of sanctions)
        pronounced.push(await pronounce(player.user, kind, from, to, author));
      const acts = expected.game === 'free' ? 1 : 0;
      expect(await verdict(player, id)).toEqual({ ...expected, operations: acts });
      if (acts === 0) {
        await lift(pronounced[0] ?? '', author);
        expect(await verdict(player, id)).toEqual({ game: 'free', speech: 'ok', operations: 1 });
      }
    }
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

  it('à chaque passage, chaque monde agit sous la version de son dernier tick ; un monde en échec ne retient pas les autres', async () => {
    const world =
      (await sql<{ id: string }>`select game.uuid_v7() as id`.execute(owner)).rows[0]?.id ?? '';
    await sql`insert into game.worlds (id, slug, name) values (${world}, ${`w-${world.slice(-12)}`}, 'Intendance')`.execute(
      owner,
    );
    // Deux versions publiées, sans activation : le tick désigne celle qu'il a lue.
    const publish = async () => {
      const published = await publishVersion(owner, INITIAL_CONFIG, { note: 'stewards test' });
      if (!published.ok) throw new Error(published.errors.join('; '));
      return published.version.id;
    };
    const [older, newer] = [await publish(), await publish()];
    await sql`insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch)
      values (${world}, 5, now(), 'stewards-test-seed', ${older}, false, false),
             (${world}, 7, now(), 'stewards-test-seed', ${newer}, false, false)`.execute(owner);
    const loaded: string[] = [];
    const byId = async (id: string) => {
      loaded.push(id);
      return { ...TEST_CONFIG, id };
    };
    const results = await runAllStewards(db, { config: { byId } });
    expect(results.find((result) => result.worldId === world)).toEqual({
      worldId: world,
      run: { acted: 0, refused: 0, failed: 0 },
    });
    expect(loaded).toContain(newer);
    expect(loaded).not.toContain(older);
    const broken = await runAllStewards(db, {
      config: {
        byId: (id) => (id === newer ? Promise.reject(new Error('panne simulée')) : byId(id)),
      },
    });
    expect(broken.find((result) => result.worldId === world)).toEqual({
      worldId: world,
      error: 'panne simulée',
    });
    // Base injoignable : rien n'est fait, et le passage du moteur n'échoue pas.
    const unreachable = createDb('postgresql://postgres:postgres@127.0.0.1:1/postgres');
    await expect(runAllStewards(unreachable, { config: { byId } })).resolves.toEqual([]);
    await unreachable.destroy();
  });
});

/** Un compte, sans maison : auteur ou validateur d'une sanction. */
async function account() {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  return id;
}
/** Sanction de `user`, de `from` à `to` secondes de maintenant (`to` nul : sans fin) ; rend son identifiant. */
async function pronounce(
  user: string,
  kind: 'warning' | 'silence' | 'suspension' | 'ban',
  from: number,
  to: number | null,
  author: string,
  validatedBy: string | null = null,
) {
  const { rows } = await sql<{ id: string }>`insert into admin.sanctions
      (user_id, kind, starts_at, ends_at, reason, author_id, validated_by)
    values (${user}, ${kind}, now() + make_interval(secs => ${from}),
            case when ${to}::int is null then null else now() + make_interval(secs => ${to}::int) end,
            'Essai', ${author}, ${validatedBy})
    returning id`.execute(owner);
  return rows[0]?.id ?? '';
}
/** Lève la sanction maintenant, comme `admin.liftSanction`. */
const lift = (sanctionId: string, by: string) =>
  sql`update admin.sanctions set lifted_at = now(), lifted_by = ${by}, ends_at = now()
    where id = ${sanctionId}`.execute(owner);
/**
 * Mène les intendants du monde pendant qu'un autre tient le verrou d'agora : `during` agit une fois qu'un intendant,
 * qui a lu la liste des intendants, attend ce verrou ; le verrou est rendu ensuite.
 */
async function whileAgoraHeld(during: () => Promise<unknown>) {
  const agora = `market:${WORLD}`;
  const held = await owner.startTransaction().execute();
  await sql`select pg_advisory_xact_lock(hashtextextended(${agora}, 0))`.execute(held);
  const running = runStewards(db, tick());
  for (let tries = 0; ; tries += 1) {
    const waiting = await sql<{ n: number }>`
      select count(*)::int as n from pg_locks, hashtextextended(${agora}, 0) as k
      where locktype = 'advisory' and not granted
        and classid::bigint = (k >> 32) & 4294967295 and objid::bigint = k & 4294967295`.execute(
      owner,
    );
    if ((waiting.rows[0]?.n ?? 0) > 0) break;
    if (tries > 300) throw new Error('The steward never waited for the agora');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await during();
  await held.commit().execute();
  return running;
}

const cityOf = async (siteId: string) =>
  (
    await db
      .selectFrom('game.sites')
      .select('city_id')
      .where('id', '=', siteId)
      .executeTakeFirstOrThrow()
  ).city_id;
