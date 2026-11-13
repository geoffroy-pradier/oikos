import { randomUUID } from 'node:crypto';
import { createDb } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';

// Tests d'intégration de la route de commandes contre Supabase local, avec la commande d'exemple `house.rename`.
// Les garanties du registre lui-même (verrou, isolation, annulation) sont testées dans registry.integration.test.ts.
const db = createDb(
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
);
const app = createApp({ db, verifyToken: async (token) => (token.length === 36 ? token : null) });
const WORLD_ID = '01900000-0000-7000-8000-000000000001';
const users: string[] = [];
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

/** Crée un compte et sa maison ; rend le compte, la maison et son nom. */
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

const rename = (
  userId: string,
  name: unknown,
  key: string | null = randomUUID(),
  command = 'house.rename',
) =>
  app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${userId}`,
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify({ name }),
  });

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
    .select(['status', 'error_code', 'idempotency_key'])
    .where('user_id', '=', userId)
    .orderBy('id')
    .execute();
const eventsOf = (houseId: string) =>
  db
    .selectFrom('game.domain_events')
    .select(['type', 'payload'])
    .where(sql<boolean>`payload->>'houseId' = ${houseId}`)
    .execute();

afterAll(async () => {
  await sql`delete from game.houses where user_id = any(${users}::uuid[])`.execute(db);
  await sql`delete from auth.users where id = any(${users}::uuid[])`.execute(db);
  await db.destroy();
});

describe('cadre de commandes : house.rename de bout en bout', () => {
  it('renomme, journalise et émet un événement dans la même transaction', async () => {
    const house = await newHouse();
    const next = `Renommée ${letters()}`;
    const res = await rename(house.userId, next);
    expect(res.status).toBe(200);
    expect(res.headers.get('Idempotent-Replay')).toBe('false');
    expect(await res.json()).toEqual({ ok: true, data: { houseId: house.houseId, name: next } });
    expect(await nameOf(house.houseId)).toBe(next);
    expect(await logOf(house.userId)).toMatchObject([{ status: 'ok', error_code: null }]);
    expect(await eventsOf(house.houseId)).toEqual([
      {
        type: 'HouseRenamed',
        payload: { houseId: house.houseId, previousName: house.name, name: next },
      },
    ]);
  });

  it('rejouer avec la même clé rend la même réponse et ne produit qu’un effet', async () => {
    const house = await newHouse();
    const [first, key] = [`Première ${letters()}`, randomUUID()];
    const original = await rename(house.userId, first, key);
    // Entre-temps la maison change encore de nom : un rejeu ne doit pas réappliquer l'ancien.
    const second = `Seconde ${letters()}`;
    expect((await rename(house.userId, second)).status).toBe(200);

    const replay = await rename(house.userId, first, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replay')).toBe('true');
    expect(await replay.json()).toEqual(await original.json());
    expect(await nameOf(house.houseId)).toBe(second);
    expect(await eventsOf(house.houseId)).toHaveLength(2);
    expect(await logOf(house.userId)).toHaveLength(2);
  });

  it('erreur métier : aucun effet, ligne « rejected », même réponse au rejeu', async () => {
    const [house, other] = [await newHouse(), await newHouse()];
    const key = randomUUID();
    const res = await rename(house.userId, other.name.toUpperCase(), key);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: { code: 'HOUSE_NAME_TAKEN' } });
    expect(await nameOf(house.houseId)).toBe(house.name);
    expect(await eventsOf(house.houseId)).toEqual([]);
    expect(await logOf(house.userId)).toMatchObject([
      { status: 'rejected', error_code: 'HOUSE_NAME_TAKEN' },
    ]);

    const replay = await rename(house.userId, other.name.toUpperCase(), key);
    expect([replay.status, replay.headers.get('Idempotent-Replay'), await replay.json()]).toEqual([
      409,
      'true',
      body,
    ]);
  });

  it('entrée invalide, compte sans maison, commande inconnue, clé absente ou mal formée', async () => {
    const house = await newHouse();
    const invalid = await rename(house.userId, 'X1');
    expect([invalid.status, await invalid.json()]).toMatchObject([
      400,
      { error: { code: 'VALIDATION_FAILED', fields: ['name'] } },
    ]);

    const homeless = randomUUID();
    const none = await rename(homeless, `Errante ${letters()}`);
    expect([none.status, await none.json()]).toMatchObject([
      404,
      { error: { code: 'HOUSE_NOT_FOUND' } },
    ]);

    const unknown = await rename(house.userId, 'Abc', randomUUID(), 'house.burn');
    expect([unknown.status, await unknown.json()]).toMatchObject([
      404,
      { error: { code: 'COMMAND_NOT_FOUND' } },
    ]);

    for (const key of [null, 'court', 'clé avec espace']) {
      const res = await rename(house.userId, `Sans clé ${letters()}`, key);
      expect([res.status, await res.json()]).toMatchObject([
        400,
        { error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } },
      ]);
    }
    expect(await nameOf(house.houseId)).toBe(house.name);
  });

  it('erreur inattendue : rien n’est écrit, la trace n’a pas de clé, et la même clé peut être retentée', async () => {
    const house = await newHouse();
    const [next, key] = [`Reprise ${letters()}`, randomUUID()];
    await sql`alter table game.domain_events add constraint test_always_fails check (false) not valid`.execute(
      db,
    );
    try {
      const res = await rename(house.userId, next, key);
      expect([res.status, await res.json()]).toMatchObject([500, { error: { code: 'INTERNAL' } }]);
    } finally {
      await sql`alter table game.domain_events drop constraint test_always_fails`.execute(db);
    }
    expect(await nameOf(house.houseId)).toBe(house.name);
    expect(await logOf(house.userId)).toMatchObject([{ status: 'failed', idempotency_key: null }]);

    const retry = await rename(house.userId, next, key);
    expect([retry.status, retry.headers.get('Idempotent-Replay')]).toEqual([200, 'false']);
    expect(await nameOf(house.houseId)).toBe(next);
  });

  it('corps trop gros : 413, sans lecture ni journal', async () => {
    const house = await newHouse();
    const res = await rename(house.userId, 'x'.repeat(20_000));
    expect([res.status, await res.json()]).toMatchObject([
      413,
      { error: { code: 'VALIDATION_FAILED' } },
    ]);
    expect(await logOf(house.userId)).toEqual([]);
  });
});
