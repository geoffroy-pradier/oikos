import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testVerifier } from './test-config';

// Travailleurs offerts par la cité (#258) : `house.create`, `site.acquire` et `site.setRecipe` refusent
// un site que la cité ne peut plus pourvoir, sans rien prélever. Contre Supabase local, chaque test dans
// son monde, à une cité dont tous les thètes travaillent.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const labor = { ...TEST_CONFIG.config.labor, workingShareBps: { thetes: 10_000 } };
const app = createApp({
  db,
  telemetry: createTelemetry(db),
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: async () => ({ ...TEST_CONFIG, config: { ...TEST_CONFIG.config, labor } }),
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const send = async (user: string, command: string, body: unknown) => {
  const res = await app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const refused = (code: string) => ({ status: 409, body: { ok: false, error: { code } } });

/** Un monde, Kallistè et ses `thetes` thètes, tous travailleurs. */
async function newCity(thetes: number) {
  const [worldId, cityId] = [randomUUID(), randomUUID()];
  await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`w-${worldId.slice(0, 12)}`}, 'Travail')),
    city as (insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Kallistè'))
    insert into game.npc_population (world_id, city_id, class_id, population) values (${worldId}, ${cityId}, 'thetes', ${thetes})`.execute(
    owner,
  );
  return cityId;
}
/** Fonde une maison dans la cité par la commande réelle : son champ de départ emploie 4 travailleurs. */
async function found(cityId: string) {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const name = `Travail ${[...user.replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
  const blazon = { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' };
  return { user, founded: await send(user, 'house.create', { cityId, name, blazon }) };
}
const stateOf = async (user: string) => {
  const { rows } = await sql<{ houses: string; balance: string | null; sites: string[] }>`select
    (select count(*) from game.houses where user_id = ${user}) as houses,
    (select a.balance from game.accounts a join game.houses h on h.id = a.house_id where h.user_id = ${user}) as balance,
    (select coalesce(array_agg(s.recipe_id order by s.created_at), '{}') from game.sites s
      join game.houses h on h.id = s.house_id where h.user_id = ${user}) as sites`.execute(db);
  const row = rows[0];
  const balance = row?.balance ?? null;
  return {
    houses: Number(row?.houses),
    balance: balance === null ? null : Number(balance),
    sites: row?.sites ?? [],
  };
};

describe('travailleurs offerts par la cité (#258)', () => {
  it('fondation : le champ de départ demande 4 travailleurs ; sans eux, ni maison, ni dotation', async () => {
    const cityId = await newCity(6);
    const alice = await found(cityId);
    expect(alice.founded.status).toBe(200);
    const bob = await found(cityId);
    expect(bob.founded).toMatchObject(refused('NO_WORKERS_AVAILABLE'));
    expect(await stateOf(bob.user)).toEqual({ houses: 0, balance: null, sites: [] });
    // Une maison déjà fondée l'apprend avant le manque de travailleurs.
    expect(
      await send(alice.user, 'house.create', {
        cityId,
        name: 'Seconde maison',
        blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
      }),
    ).toMatchObject(refused('HOUSE_ALREADY_EXISTS'));
  });

  it('acquisition et changement de recette : refusés au-delà de l’offre, sans rien prélever', async () => {
    const cityId = await newCity(6);
    const { user } = await found(cityId);
    const grant = TEST_CONFIG.config.starting.grantOboles;
    // 4 + 2 : l'offre est pleine, exactement.
    expect(await send(user, 'site.acquire', { recipeId: 'mill_flour' })).toMatchObject({
      status: 200,
    });
    const paid = grant - (TEST_CONFIG.config.sites.acquisitionCostOboles['workshop'] ?? 0);
    expect(await stateOf(user)).toMatchObject({ balance: paid });
    expect(await send(user, 'site.acquire', { recipeId: 'press_oil' })).toMatchObject(
      refused('NO_WORKERS_AVAILABLE'),
    );
    expect(await stateOf(user)).toEqual({
      houses: 1,
      balance: paid,
      sites: ['grow_wheat', 'mill_flour'],
    });
    const { id: mill } = await db
      .selectFrom('game.sites')
      .select('id')
      .where('recipe_id', '=', 'mill_flour')
      .where('city_id', '=', cityId)
      .executeTakeFirstOrThrow();
    // Le tissage en demande 3 : un de plus que la farine, refusé ; le pain en demande autant, admis.
    expect(
      await send(user, 'site.setRecipe', { siteId: mill, recipeId: 'weave_cloth' }),
    ).toMatchObject(refused('NO_WORKERS_AVAILABLE'));
    expect(
      await send(user, 'site.setRecipe', { siteId: mill, recipeId: 'bake_bread' }),
    ).toMatchObject({ status: 200 });
    // La population tombe sous l'emploi : rien ne s'arrête, mais rien de nouveau ne s'ouvre.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.npc_population disable trigger npc_population_guard`.execute(trx);
      await sql`update game.npc_population set population = 3 where city_id = ${cityId}`.execute(
        trx,
      );
      await sql`alter table game.npc_population enable trigger npc_population_guard`.execute(trx);
    });
    expect(await send(user, 'site.acquire', { recipeId: 'grow_wheat' })).toMatchObject(
      refused('NO_WORKERS_AVAILABLE'),
    );
    expect((await stateOf(user)).sites).toEqual(['grow_wheat', 'bake_bread']);
  });

  it('concurrence : deux acquisitions pour les deux derniers travailleurs, une seule passe', async () => {
    const cityId = await newCity(10);
    const [alice, bob] = [await found(cityId), await found(cityId)];
    const results = await Promise.all(
      [alice, bob].map(({ user }) => send(user, 'site.acquire', { recipeId: 'mill_flour' })),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)).toMatchObject(
      refused('NO_WORKERS_AVAILABLE'),
    );
    const { rows } = await sql<{ n: string }>`select count(*) as n from game.sites
      where city_id = ${cityId}`.execute(db);
    expect(Number(rows[0]?.n)).toBe(3);
  });

  it('configuration neutre (aucune classe travailleuse) : l’offre est sans limite', async () => {
    const cityId = await newCity(0);
    const neutral = createApp({
      db,
      telemetry: createTelemetry(db),
      verifyToken: testVerifier,
      rateLimiter: unlimited,
      loadConfig: async () => TEST_CONFIG,
    });
    const user = randomUUID();
    await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
      owner,
    );
    const res = await neutral.request('/api/commands/house.create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${user}`,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        cityId,
        name: `Neutre ${[...user.replace(/[^a-f]/g, '')].slice(0, 10).join('')}`,
        blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
      }),
    });
    expect(res.status).toBe(200);
  });
});
