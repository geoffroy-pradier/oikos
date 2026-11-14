import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';
import { unlimited } from './rate-limit';

// Tests d'intégration contre Supabase local (`pnpm db:start`).
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CITY_ID = '01900000-0000-7000-8000-000000000101';

// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const telemetry = createTelemetry(db);
const owner = createDb(DATABASE_URL);
// Le jeton est le compte lui-même : la vérification du JWT est testée à part (auth.test.ts).
const app = createApp({
  db,
  telemetry,
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
const users: string[] = [];
const suffix = [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 6).join('');

async function newUser(): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
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

// Pas de nettoyage : une maison fondée a une écriture au grand livre, qui est en ajout seul.
// Les comptes et les noms sont aléatoires ; la base locale se recrée par `pnpm db:reset`.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const GRANT = TEST_CONFIG.config.starting.grantOboles;
/** Monnaie créée par le robinet de dotation dans le monde de test, en oboles (solde négatif du robinet). */
const granted = async () =>
  -Number(
    (
      await db
        .selectFrom('game.accounts')
        .select('balance')
        .where('system_key', '=', 'faucet_starting_grant')
        .where('world_id', '=', '01900000-0000-7000-8000-000000000001')
        .executeTakeFirstOrThrow()
    ).balance,
  );
const endowmentOf = async (houseId: string) => ({
  balance: (
    await db.selectFrom('game.accounts').select('balance').where('house_id', '=', houseId).execute()
  ).map((row) => Number(row.balance)),
  sites: (
    await db.selectFrom('game.sites').select('recipe_id').where('house_id', '=', houseId).execute()
  ).map((row) => row.recipe_id),
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
    await sql`alter table game.citizenships drop constraint if exists test_always_fails`.execute(
      owner,
    );
    await sql`alter table game.citizenships add constraint test_always_fails check (false) not valid`.execute(
      owner,
    );
    try {
      const res = await post(user, input(`Orpheline ${suffix}`));
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ error: { code: 'INTERNAL' } });
    } finally {
      await sql`alter table game.citizenships drop constraint test_always_fails`.execute(owner);
    }
    expect(await housesOf(user)).toEqual([]);
  });

  it('est atomique jusqu’au bout : si le premier site échoue, ni maison, ni compte, ni monnaie créée', async () => {
    const user = await newUser();
    const before = await granted();
    await sql`alter table game.sites drop constraint if exists test_always_fails`.execute(owner);
    await sql`alter table game.sites add constraint test_always_fails check (false) not valid`.execute(
      owner,
    );
    try {
      const res = await post(user, input(`Sans champ ${suffix}`));
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ error: { code: 'INTERNAL' } });
    } finally {
      await sql`alter table game.sites drop constraint test_always_fails`.execute(owner);
    }
    expect([await housesOf(user), await granted()]).toEqual([[], before]);
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
    const before = await granted();
    const [first, replay] = [await request(), await request()];
    expect(await granted()).toBe(before + GRANT);
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

  it('ouvre le compte, verse la dotation par le robinet prévu et confie le premier site', async () => {
    const user = await newUser();
    const before = await granted();
    const body = (await (await post(user, input(`Dotée ${suffix}`))).json()) as {
      data: { houseId: string };
    };
    expect(await endowmentOf(body.data.houseId)).toEqual({
      balance: [GRANT],
      sites: [TEST_CONFIG.config.starting.siteRecipeId],
    });
    expect(await granted()).toBe(before + GRANT);
    // Une seule écriture, équilibrée, entre le robinet et la maison.
    const lines = await db
      .selectFrom('game.ledger_lines as l')
      .innerJoin('game.ledger_entries as e', 'e.id', 'l.entry_id')
      .innerJoin('game.accounts as a', 'a.id', 'l.account_id')
      .select(['e.kind', 'a.system_key', 'l.amount'])
      .where(sql<boolean>`e.meta->>'houseId' = ${body.data.houseId}`)
      .orderBy('l.amount')
      .execute();
    expect(lines).toEqual([
      { kind: 'house.starting_grant', system_key: 'faucet_starting_grant', amount: String(-GRANT) },
      { kind: 'house.starting_grant', system_key: null, amount: String(GRANT) },
    ]);
    // Une seconde tentative du même compte ne crée ni monnaie ni site.
    expect((await post(user, input(`Encore ${suffix}`))).status).toBe(409);
    expect(await granted()).toBe(before + GRANT);
    expect((await endowmentOf(body.data.houseId)).sites).toHaveLength(1);
  });

  it('le montant de la dotation et la recette du premier site viennent de la configuration active', async () => {
    const other = TEST_CONFIG.config.recipes.find(
      (recipe) =>
        recipe.inputs.length === 0 && recipe.id !== TEST_CONFIG.config.starting.siteRecipeId,
    );
    if (!other) throw new Error('the test configuration needs a second primary recipe');
    const starting = { grantOboles: GRANT + 1234, siteRecipeId: other.id };
    const tuned = createApp({
      db,
      telemetry,
      verifyToken: testVerifier,
      rateLimiter: unlimited,
      loadConfig: async () => ({ ...TEST_CONFIG, config: { ...TEST_CONFIG.config, starting } }),
    });
    const user = await newUser();
    const before = await granted();
    const res = await tuned.request('/api/commands/house.create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${user}`,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(input(`Réglée ${suffix}`)),
    });
    const body = (await res.json()) as { data: { houseId: string } };
    expect(await endowmentOf(body.data.houseId)).toEqual({
      balance: [starting.grantOboles],
      sites: [other.id],
    });
    expect(await granted()).toBe(before + starting.grantOboles);
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
    const [house] = await housesOf(user);
    expect(await endowmentOf(house?.id ?? '')).toMatchObject({ balance: [GRANT] });
  });
});
