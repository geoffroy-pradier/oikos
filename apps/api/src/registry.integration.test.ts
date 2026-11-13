import { randomUUID } from 'node:crypto';
import type { DomainEvent } from '@oikos/contracts';
import { createDb } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand, executeCommand, type CommandContext, type CommandResult } from './registry';
import { TEST_CONFIG, testConfig } from './test-config';

// Tests d'intégration du registre contre Supabase local, avec des commandes d'essai qui renomment une maison.
const db = createDb(
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
);
const WORLD_ID = '01900000-0000-7000-8000-000000000001';
const users: string[] = [];
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

async function newHouse() {
  const [userId, name] = [randomUUID(), `Maison ${letters()}`];
  await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`.execute(
    db,
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
const eventsOf = async (houseId: string) =>
  (await sql`select 1 from game.domain_events where payload->>'houseId' = ${houseId}`.execute(db))
    .rows.length;

afterAll(async () => {
  await sql`delete from game.houses where user_id = any(${users}::uuid[])`.execute(db);
  await sql`delete from auth.users where id = any(${users}::uuid[])`.execute(db);
  await db.destroy();
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

  it('entrée invalide ou non stockable : refus journalisé, jamais d’erreur 500 ni de trou dans le journal', async () => {
    const [house, command] = [await newHouse(), probe('probe.rename')];
    const deep = JSON.parse(`${'['.repeat(6000)}${']'.repeat(6000)}`) as unknown;
    const inputs = [
      { name: 'ab' },
      null,
      { name: 'ab\u0000cd' },
      { name: 'Bon Nom', 'x\u0000': 1 },
      { name: '\ud800xyz' },
      deep,
    ];
    for (const input of inputs) {
      expect((await run(command, house.userId, input)).response).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    const log = await logOf(house.userId);
    expect(log.map((row) => row.status)).toEqual(inputs.map(() => 'rejected'));
    expect(log.slice(2).map((row) => row.input)).toEqual(
      inputs.slice(2).map(() => ({ unstorable: true })),
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
    // Horloge de la base : proche de celle du test, sans lui être identique.
    expect(Math.abs((seen?.now.getTime() ?? 0) - before)).toBeLessThan(60_000);
  });

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
  });
});
