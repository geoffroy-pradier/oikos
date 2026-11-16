import { randomUUID } from 'node:crypto';
import type { DomainEvent } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineCommand,
  executeCommand,
  type CommandContext,
  type CommandOutcome,
  type CommandResult,
} from './registry';
import { TEST_CONFIG, testConfig } from './test-config';

// Tests d'intégration du registre contre Supabase local, avec des commandes d'essai qui renomment une maison.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const WORLD_ID = '01900000-0000-7000-8000-000000000001';
const users: string[] = [];
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

async function newHouse() {
  const [userId, name] = [randomUUID(), `Maison ${letters()}`];
  await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`.execute(
    owner,
  );
  const house = await db
    .insertInto('game.houses')
    .values({ world_id: WORLD_ID, user_id: userId, name, blazon: '{}' })
    .returning('id')
    .executeTakeFirstOrThrow();
  users.push(userId);
  return { userId, houseId: house.id, name };
}

type Output = { houseId: string; name: string };
/** Commande d'essai : renomme la maison du compte, puis applique le comportement demandé. */
function probe(
  name: string,
  after?: (context: CommandContext, output: Output) => CommandResult<unknown> | undefined,
) {
  let runs = 0;
  const command = defineCommand({
    name,
    input: z.strictObject({ name: z.string().min(3) }),
    output: z.strictObject({ houseId: z.uuid(), name: z.string() }),
    errors: ['PROBE_REFUSED'],
    errorByConstraint: { houses_name_unique: { code: 'HOUSE_NAME_TAKEN', message: 'taken' } },
    async handler(context, input): Promise<CommandResult<Output>> {
      runs += 1;
      const house = await context.trx
        .updateTable('game.houses')
        .set({ name: input.name })
        .where('user_id', '=', context.userId)
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();
      const output = { houseId: house.id, name: house.name };
      context.emit({
        type: 'HouseRenamed',
        payload: { houseId: house.id, previousName: '?', name: house.name },
      });
      return (
        (after?.(context, output) as CommandResult<Output> | undefined) ?? {
          ok: true,
          data: output,
        }
      );
    },
  });
  return Object.assign(command, { runs: () => runs });
}

const run = (
  command: ReturnType<typeof probe>,
  userId: string,
  input: unknown,
  idempotencyKey = randomUUID(),
) => executeCommand(db, command, { userId, idempotencyKey, input }, testConfig);
const nameOf = async (houseId: string) =>
  (
    await db
      .selectFrom('game.houses')
      .select('name')
      .where('id', '=', houseId)
      .executeTakeFirstOrThrow()
  ).name;
const logOf = (userId: string) =>
  db
    .selectFrom('game.command_log')
    .select(['status', 'error_code', 'idempotency_key', 'input'])
    .where('user_id', '=', userId)
    .orderBy('id')
    .execute();
const contextOf = (userId: string) =>
  db
    .selectFrom('game.command_log')
    .select(['status', 'aal', 'admin_role', 'config_version_id'])
    .where('user_id', '=', userId)
    .orderBy('id')
    .execute();
const eventsOf = async (houseId: string) =>
  (await sql`select 1 from game.domain_events where payload->>'houseId' = ${houseId}`.execute(db))
    .rows.length;

afterAll(async () => {
  await sql`delete from game.houses where user_id = any(${users}::uuid[])`.execute(owner);
  await sql`delete from auth.users where id = any(${users}::uuid[])`.execute(owner);
  await Promise.all([db.destroy(), owner.destroy()]);
});

describe('executeCommand', () => {
  it('réussite : effets, événement et ligne « ok » validés ensemble ; le rejeu ne réexécute rien', async () => {
    const [house, command, key] = [await newHouse(), probe('probe.rename'), randomUUID()];
    const next = `Renommée ${letters()}`;
    const first = await run(command, house.userId, { name: next }, key);
    expect(first).toEqual({
      replayed: false,
      response: { ok: true, data: { houseId: house.houseId, name: next } },
    });
    await run(command, house.userId, { name: `Ensuite ${letters()}` });

    // Rejeu tardif, clés de l'entrée dans un autre ordre : même réponse, l'ancien nom n'est pas réappliqué.
    const replay = await executeCommand(
      db,
      command,
      { userId: house.userId, idempotencyKey: key, input: JSON.parse(`{"name":"${next}"}`) },
      testConfig,
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expect([command.runs(), await eventsOf(house.houseId)]).toEqual([2, 2]);
    expect(await nameOf(house.houseId)).not.toBe(next);
    expect(await logOf(house.userId)).toMatchObject([{ status: 'ok' }, { status: 'ok' }]);
  });

  it('dix requêtes de même clé qui se chevauchent : une seule exécution, neuf rejeux', async () => {
    const [house, command, key] = [await newHouse(), probe('probe.rename'), randomUUID()];
    const next = `Course ${letters()}`;
    // Un tiers tient la maison verrouillée : les requêtes sont toutes en attente au même moment.
    const blocker = await db.startTransaction().execute();
    await blocker
      .selectFrom('game.houses')
      .select('id')
      .where('id', '=', house.houseId)
      .forUpdate()
      .execute();
    const pending = Array.from({ length: 10 }, () =>
      run(command, house.userId, { name: next }, key),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await blocker.commit().execute();

    const outcomes = await Promise.all(pending);
    expect(outcomes.filter((outcome) => outcome.replayed)).toHaveLength(9);
    for (const outcome of outcomes) expect(outcome.response).toEqual(outcomes[0]?.response);
    expect(outcomes[0]?.response).toEqual({
      ok: true,
      data: { houseId: house.houseId, name: next },
    });
    expect([command.runs(), await eventsOf(house.houseId)]).toEqual([1, 1]);
    expect(await logOf(house.userId)).toHaveLength(1);
  });

  it('la clé est propre au compte et à la commande', async () => {
    const [alice, bob, key] = [await newHouse(), await newHouse(), randomUUID()];
    const [rename, other] = [probe('probe.rename'), probe('probe.other')];
    const [a, b] = [`Alice ${letters()}`, `Bob ${letters()}`];
    expect((await run(rename, alice.userId, { name: a }, key)).response.ok).toBe(true);
    // Même clé, autre compte : exécution indépendante, pas le rejeu de la réponse d'Alice.
    expect(await run(rename, bob.userId, { name: b }, key)).toMatchObject({
      replayed: false,
      response: { data: { houseId: bob.houseId, name: b } },
    });
    // Même clé, même compte : autre commande ou autre entrée refusées, sans exécution.
    for (const attempt of [
      run(other, alice.userId, { name: a }, key),
      run(rename, alice.userId, { name: `Autre ${letters()}` }, key),
    ]) {
      expect(await attempt).toMatchObject({
        replayed: false,
        response: { error: { code: 'IDEMPOTENCY_KEY_REUSED' } },
      });
    }
    expect([other.runs(), await nameOf(alice.houseId)]).toEqual([0, a]);
  });

  it('erreur métier, rendue ou déduite d’une contrainte : effets annulés, ligne « rejected », même réponse au rejeu', async () => {
    const [house, other, key] = [await newHouse(), await newHouse(), randomUUID()];
    const refusing = probe('probe.refuse', () => ({
      ok: false,
      error: { code: 'PROBE_REFUSED', message: 'no' },
    }));
    const refused = await run(refusing, house.userId, { name: `Refusée ${letters()}` }, key);
    expect(refused.response).toEqual({
      ok: false,
      error: { code: 'PROBE_REFUSED', message: 'no' },
    });
    expect(
      await run(
        refusing,
        house.userId,
        JSON.parse(JSON.stringify((await logOf(house.userId))[0]?.input)),
        key,
      ),
    ).toEqual({ ...refused, replayed: true });

    const taken = await run(probe('probe.rename'), house.userId, {
      name: other.name.toUpperCase(),
    });
    expect(taken.response).toMatchObject({ ok: false, error: { code: 'HOUSE_NAME_TAKEN' } });
    expect([await nameOf(house.houseId), await eventsOf(house.houseId), refusing.runs()]).toEqual([
      house.name,
      0,
      1,
    ]);
    expect(await logOf(house.userId)).toMatchObject([
      { status: 'rejected', error_code: 'PROBE_REFUSED' },
      { status: 'rejected', error_code: 'HOUSE_NAME_TAKEN' },
    ]);
  });

  it('contrôle de la base à la validation : erreur métier, effets annulés, ligne « rejected » sous la clé, même réponse au rejeu', async () => {
    const [house, key] = [await newHouse(), randomUUID()];
    // Renomme la maison, puis viole une contrainte que seule la validation contrôle (comme les
    // déclencheurs différés des activations) : l'échec vient du COMMIT, pas d'une instruction.
    const lateCheck = (name: string, constraint: string) => {
      const rename = probe(name);
      return defineCommand({
        ...rename,
        errorByConstraint: { [constraint]: { code: 'PROBE_TOO_LATE', message: 'late' } },
        async handler(context, input) {
          const result = await rename.handler(context, input);
          await sql`create temporary table probe_late (x int, constraint probe_checked_at_commit
            unique (x) deferrable initially deferred) on commit drop`.execute(context.trx);
          await sql`insert into probe_late values (1), (1)`.execute(context.trx);
          return result;
        },
      });
    };
    const command = lateCheck('probe.lateCheck', 'probe_checked_at_commit');
    const first = await executeCommand(
      db,
      command,
      { userId: house.userId, idempotencyKey: key, input: { name: `Tardive ${letters()}` } },
      testConfig,
    );
    expect(first).toEqual({
      replayed: false,
      response: { ok: false, error: { code: 'PROBE_TOO_LATE', message: 'late' } },
    });
    const input = (await logOf(house.userId))[0]?.input;
    const replay = await executeCommand(
      db,
      command,
      { userId: house.userId, idempotencyKey: key, input },
      testConfig,
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expect([await nameOf(house.houseId), await eventsOf(house.houseId)]).toEqual([house.name, 0]);
    expect(await logOf(house.userId)).toMatchObject([
      { status: 'rejected', error_code: 'PROBE_TOO_LATE', idempotency_key: key },
    ]);
    // Une contrainte que la commande ne connaît pas reste une panne : trace sans clé.
    const unknown = lateCheck('probe.lateUnknown', 'another_constraint');
    const failed = await executeCommand(
      db,
      unknown,
      { userId: house.userId, idempotencyKey: randomUUID(), input: { name: `Autre ${letters()}` } },
      testConfig,
    );
    expect(failed.response).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect((await logOf(house.userId)).at(-1)).toMatchObject({
      status: 'failed',
      idempotency_key: null,
    });
  });

  it('validation refusée pendant qu’une requête de même clé attend : elle s’exécute, et sa réponse vaut pour les deux', async () => {
    const [house, key, name] = [await newHouse(), randomUUID(), `Croisée ${letters()}`];
    const rename = probe('probe.crossed');
    let second: Promise<CommandOutcome> | undefined;
    const request = { userId: house.userId, idempotencyKey: key, input: { name } };
    const command = defineCommand({
      ...rename,
      errorByConstraint: { probe_checked_at_commit: { code: 'PROBE_TOO_LATE', message: 'late' } },
      async handler(context, input) {
        const result = await rename.handler(context, input);
        if (second) return result;
        // Première exécution : la requête de même clé part et attend le verrou de la clé ; puis une
        // contrainte que seule la validation contrôle fera échouer le COMMIT, qui libère ce verrou.
        second = executeCommand(db, command, request, testConfig);
        for (let tries = 0; tries < 100; tries++) {
          const waiting = await sql<{ n: number }>`select count(*)::int as n from pg_locks
            where locktype = 'advisory' and not granted
              and objid = (hashtextextended(${`${house.userId}:${key}`}, 0) & 4294967295)::oid`.execute(
            owner,
          );
          if ((waiting.rows[0]?.n ?? 0) > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await sql`create temporary table probe_crossed (x int, constraint probe_checked_at_commit
          unique (x) deferrable initially deferred) on commit drop`.execute(context.trx);
        await sql`insert into probe_crossed values (1), (1)`.execute(context.trx);
        return result;
      },
    });
    const first = await executeCommand(db, command, request, testConfig);
    const other = await second;
    // La seconde s'est exécutée et a validé son effet : la première rend sa réponse, en rejeu.
    expect(other).toEqual({
      replayed: false,
      response: { ok: true, data: { houseId: house.houseId, name } },
    });
    expect(first).toEqual({ ...other, replayed: true });
    expect([await nameOf(house.houseId), rename.runs()]).toEqual([name, 2]);
    expect(await logOf(house.userId)).toMatchObject([{ status: 'ok', idempotency_key: key }]);
  });

  it('entrée invalide ou non stockable : refus journalisé, jamais d’erreur 500 ni de trou dans le journal', async () => {
    const [house, command] = [await newHouse(), probe('probe.rename')];
    const nested = (depth: number) =>
      JSON.parse(`${'['.repeat(depth)}${']'.repeat(depth)}`) as unknown;
    // En dernier, 3 500 niveaux : `JSON.stringify` passe, la forme canonique (récursive) dépasse la pile
    // dans Node par défaut ; refusée, l'entrée a sa ligne au journal, quelle que soit la profondeur atteinte.
    const inputs = [
      { name: 'ab' },
      null,
      { name: 'ab\u0000cd' },
      { name: 'Bon Nom', 'x\u0000': 1 },
      { name: '\ud800xyz' },
      nested(6000),
      nested(3500),
    ];
    for (const input of inputs) {
      expect((await run(command, house.userId, input)).response).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    const log = await logOf(house.userId);
    expect(log.map((row) => row.status)).toEqual(inputs.map(() => 'rejected'));
    expect(log.slice(2, -1).map((row) => row.input)).toEqual(
      inputs.slice(2, -1).map(() => ({ unstorable: true })),
    );
    expect([command.runs(), await nameOf(house.houseId)]).toEqual([0, house.name]);
  });

  it('sortie ou événement non conforme, exception : rien n’est écrit, trace sans clé, la clé reste utilisable', async () => {
    const house = await newHouse();
    const broken = [
      probe('probe.badOutput', (_context, output) => ({ ok: true, data: { ...output, extra: 1 } })),
      probe('probe.badEvent', ({ emit }) => {
        emit({ type: 'HouseBurned', payload: {} } as unknown as DomainEvent);
        return undefined;
      }),
      probe('probe.throws', () => {
        throw new Error('panne simulée');
      }),
    ];
    const key = randomUUID();
    for (const command of broken) {
      expect(
        (await run(command, house.userId, { name: `Cassée ${letters()}` }, key)).response,
      ).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    }
    expect([await nameOf(house.houseId), await eventsOf(house.houseId)]).toEqual([house.name, 0]);
    expect(await logOf(house.userId)).toMatchObject(
      broken.map(() => ({ status: 'failed', idempotency_key: null })),
    );

    const next = `Reprise ${letters()}`;
    expect(await run(probe('probe.rename'), house.userId, { name: next }, key)).toMatchObject({
      replayed: false,
      response: { ok: true },
    });
    expect(await nameOf(house.houseId)).toBe(next);
  });

  it('la commande reçoit la configuration active et l’heure de la base', async () => {
    const house = await newHouse();
    let seen: Pick<CommandContext, 'config' | 'now'> | undefined;
    const command = probe('probe.context', ({ config, now }) => {
      seen = { config, now };
      return undefined;
    });
    const before = Date.now();
    await run(command, house.userId, { name: `Contexte ${letters()}` });
    expect(seen?.config).toBe(TEST_CONFIG.config);
    expect(seen?.config.starting.grantOboles).toBeGreaterThan(0);
    expect(Math.abs((seen?.now.getTime() ?? 0) - before)).toBeLessThan(60_000);
  });

  it('`now` est l’heure de la base au début de la transaction, pas l’horloge du processus', async () => {
    const house = await newHouse();
    const command = defineCommand({
      name: 'probe.clock',
      input: z.strictObject({}),
      output: z.strictObject({ contextNow: z.string(), databaseNow: z.string() }),
      errors: [],
      async handler({ trx, now }) {
        const clock = await sql<{ now: Date }>`select now() as now`.execute(trx);
        const databaseNow = clock.rows[0]?.now.toISOString() ?? '';
        return { ok: true, data: { contextNow: now.toISOString(), databaseNow } };
      },
    });
    const request = { userId: house.userId, idempotencyKey: randomUUID(), input: {} };
    const { response } = await executeCommand(db, command, request, testConfig);
    if (!response.ok) throw new Error(response.error.message);
    const data = response.data as { contextNow: string; databaseNow: string };
    expect(data.contextNow).toBe(data.databaseNow);
  });

  it('plus de commandes simultanées que de connexions : le chargement de la configuration ne bloque pas le pool', async () => {
    const small = createDb(DATABASE_URL, { max: 2 });
    // Comme le chargeur réel, cette source emprunte une connexion du même pool.
    const pooledConfig = async () => {
      await sql`select 1`.execute(small);
      return TEST_CONFIG;
    };
    try {
      const houses = await Promise.all(Array.from({ length: 8 }, () => newHouse()));
      const command = probe('probe.pool');
      const all = Promise.all(
        houses.map((house) =>
          executeCommand(
            small,
            command,
            {
              userId: house.userId,
              idempotencyKey: randomUUID(),
              input: { name: `Pool ${letters()}` },
            },
            pooledConfig,
          ),
        ),
      );
      const timeout = new Promise<'blocked'>((resolve) =>
        setTimeout(() => resolve('blocked'), 8000),
      );
      const outcome = await Promise.race([all, timeout]);
      if (outcome === 'blocked') throw new Error('pool exhausted: commands never returned');
      expect(outcome.map((result) => result.response.ok)).toEqual(houses.map(() => true));
    } finally {
      // Sans attendre : en cas de blocage, les connexions ne se libèrent jamais.
      void small.destroy();
    }
  }, 15_000);

  it('configuration indisponible : rien n’est exécuté, trace sans clé, la clé reste utilisable', async () => {
    const house = await newHouse();
    const command = probe('probe.noConfig');
    const key = randomUUID();
    const request = {
      userId: house.userId,
      idempotencyKey: key,
      input: { name: `Sans ${letters()}` },
    };
    const outcome = await executeCommand(db, command, request, async () => {
      throw new Error('aucune configuration active');
    });
    expect(outcome.response).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect([command.runs(), await nameOf(house.houseId)]).toEqual([0, house.name]);
    expect(await logOf(house.userId)).toMatchObject([{ status: 'failed', idempotency_key: null }]);
    expect((await executeCommand(db, command, request, testConfig)).response).toMatchObject({
      ok: true,
    });
    // La panne est journalisée sans version (aucune n'a pu être lue), la réussite avec la sienne.
    expect(await contextOf(house.userId)).toEqual([
      { status: 'failed', aal: 'aal1', admin_role: null, config_version_id: null },
      { status: 'ok', aal: 'aal1', admin_role: null, config_version_id: TEST_CONFIG.id },
    ]);
  });

  it('le journal porte le contexte de chaque commande : session, version de configuration, y compris en cas de refus ou de panne', async () => {
    const house = await newHouse();
    const config = TEST_CONFIG.id;
    await run(probe('probe.context'), house.userId, { name: `Contexte ${letters()}` });
    await executeCommand(
      db,
      probe('probe.strong'),
      {
        userId: house.userId,
        aal: 'aal2',
        idempotencyKey: randomUUID(),
        input: { name: `Fort ${letters()}` },
      },
      testConfig,
    );
    await run(probe('probe.invalid'), house.userId, { name: 42 });
    await run(
      probe('probe.broken', () => {
        throw new Error('panne simulée');
      }),
      house.userId,
      { name: `Panne ${letters()}` },
    );
    expect(await contextOf(house.userId)).toEqual([
      { status: 'ok', aal: 'aal1', admin_role: null, config_version_id: config },
      { status: 'ok', aal: 'aal2', admin_role: null, config_version_id: config },
      { status: 'rejected', aal: 'aal1', admin_role: null, config_version_id: config },
      { status: 'failed', aal: 'aal1', admin_role: null, config_version_id: config },
    ]);
  });
});
