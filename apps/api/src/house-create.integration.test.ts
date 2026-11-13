import { randomUUID } from 'node:crypto';
import { createDb } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';

// Tests d'intégration contre Supabase local (`pnpm db:start`).
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CITY_ID = '01900000-0000-7000-8000-000000000101';

const db = createDb(DATABASE_URL);
// Le jeton est le compte lui-même : la vérification du JWT est testée à part (auth.test.ts).
const app = createApp({ db, verifyToken: async (token) => (token.length === 36 ? token : null) });
const users: string[] = [];
const suffix = [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 6).join('');

async function newUser(): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(db);
  users.push(id);
  return id;
}

const post = (token: string | null, body: unknown) =>
  app.request('/api/commands/house.create', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': randomUUID(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const housesOf = (userId: string) =>
  db.selectFrom('game.houses').select('id').where('user_id', '=', userId).execute();

const input = (name: string) => ({
  cityId: CITY_ID,
  name,
  blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
});

beforeAll(async () => {
  await sql`select 1`.execute(db);
});

afterAll(async () => {
  await sql`delete from game.citizenships where house_id in (select id from game.houses where user_id = any(${users}::uuid[]))`.execute(
    db,
  );
  await sql`delete from game.houses where user_id = any(${users}::uuid[])`.execute(db);
  await sql`delete from auth.users where id = any(${users}::uuid[])`.execute(db);
  await db.destroy();
});

describe('house.create', () => {
  it('refuse une requête sans jeton', async () => {
    const res = await post(null, input(`Sans jeton ${suffix}`));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('refuse un jeton rejeté par le vérificateur ou un en-tête sans « Bearer », sans rien écrire', async () => {
    const user = await newUser();
    const headers = { 'content-type': 'application/json', 'Idempotency-Key': randomUUID() };
    const body = JSON.stringify(input(`Refusée ${suffix}`));
    for (const authorization of ['Bearer invalide', user]) {
      const res = await app.request('/api/commands/house.create', {
        method: 'POST',
        headers: { ...headers, authorization },
        body,
      });
      expect(res.status).toBe(401);
    }
    expect(await housesOf(user)).toEqual([]);
  });

  it('prend le compte dans le jeton, jamais dans le corps', async () => {
    const [caller, victim] = [await newUser(), await newUser()];
    const res = await post(caller, { ...input(`Usurpée ${suffix}`), userId: victim });
    expect(res.status).toBe(400);
    expect([await housesOf(caller), await housesOf(victim)]).toEqual([[], []]);
  });

  it('est atomique : si l’inscription dans la cité échoue, la maison n’est pas créée', async () => {
    const user = await newUser();
    await sql`alter table game.citizenships add constraint test_always_fails check (false) not valid`.execute(
      db,
    );
    try {
      const res = await post(user, input(`Orpheline ${suffix}`));
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ error: { code: 'INTERNAL' } });
    } finally {
      await sql`alter table game.citizenships drop constraint test_always_fails`.execute(db);
    }
    expect(await housesOf(user)).toEqual([]);
  });

  it('émet HouseFounded et rejoue sans second effet quand la réponse a été perdue', async () => {
    const user = await newUser();
    const request = () =>
      app.request('/api/commands/house.create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${user}`,
          'Idempotency-Key': `lost-${user}`,
        },
        body: JSON.stringify(input(`Perdue ${suffix}`)),
      });
    const [first, replay] = [await request(), await request()];
    expect([first.status, replay.status, replay.headers.get('Idempotent-Replay')]).toEqual([
      200,
      200,
      'true',
    ]);
    expect(await replay.json()).toEqual(await first.json());
    const [house] = await housesOf(user);
    const events = await db
      .selectFrom('game.domain_events')
      .select('type')
      .where(sql<boolean>`payload->>'houseId' = ${house?.id ?? ''}`)
      .execute();
    expect(events).toEqual([{ type: 'HouseFounded' }]);
  });

  it('fonde la maison et l’inscrit comme métèque dans la cité', async () => {
    const user = await newUser();
    const res = await post(user, input(`Alcmé ${suffix}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { houseId: string } };
    expect(body).toMatchObject({
      ok: true,
      data: { name: `Alcmé ${suffix}`, cityId: CITY_ID, citizenshipStatus: 'metic' },
    });
    const rows = await db
      .selectFrom('game.houses as h')
      .innerJoin('game.citizenships as c', 'c.house_id', 'h.id')
      .select(['h.user_id', 'h.blazon', 'c.city_id', 'c.status'])
      .where('h.id', '=', body.data.houseId)
      .execute();
    expect(rows).toEqual([
      { user_id: user, blazon: input('x').blazon, city_id: CITY_ID, status: 'metic' },
    ]);
  });

  it('refuse une seconde maison pour le même compte', async () => {
    const user = await newUser();
    expect((await post(user, input(`Première ${suffix}`))).status).toBe(200);
    const res = await post(user, input(`Seconde ${suffix}`));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'HOUSE_ALREADY_EXISTS' } });
  });

  it('refuse un nom déjà pris, sans tenir compte de la casse, et n’écrit rien', async () => {
    const [first, second] = [await newUser(), await newUser()];
    expect((await post(first, input(`Unique ${suffix}`))).status).toBe(200);
    const res = await post(second, input(`UNIQUE ${suffix.toUpperCase()}`));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'HOUSE_NAME_TAKEN' } });
    const houses = await db
      .selectFrom('game.houses')
      .select('id')
      .where('user_id', '=', second)
      .execute();
    expect(houses).toEqual([]);
  });

  it('refuse une entrée invalide en nommant les champs', async () => {
    const user = await newUser();
    const res = await post(user, { ...input('X1'), blazon: { shape: 'hoplon' } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; fields: string[] } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields).toEqual(expect.arrayContaining(['name', 'blazon.tincture']));
  });

  it('traduit un nom refusé par la base seule en erreur de validation', async () => {
    const user = await newUser();
    // U+1C89 : lettre cyrillique d'Unicode 16, connue de Node 22 mais pas de la base.
    const res = await post(user, input(`Ab\u{1C89}cd`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', fields: ['name'] },
    });
  });

  it('refuse une cité inconnue', async () => {
    const user = await newUser();
    const res = await post(user, { ...input(`Errante ${suffix}`), cityId: randomUUID() });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'CITY_NOT_FOUND' } });
  });

  it('deux créations simultanées du même compte : une seule maison', async () => {
    const user = await newUser();
    const results = await Promise.all([
      post(user, input(`Course a ${suffix}`)),
      post(user, input(`Course b ${suffix}`)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});
