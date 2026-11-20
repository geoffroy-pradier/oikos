import { randomUUID } from 'node:crypto';
import type { GameConfig, LoadedConfig } from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testVerifier } from './test-config';

// Douze cités, leur terroir et leur recette de départ (docs/specs/06-cites-politique-communaute.md, 6.1 ;
// tickets 250 et 706), contre Supabase local. Le fichier a son monde, aux douze cités de la configuration.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
let active: LoadedConfig = TEST_CONFIG;
const app = createApp({
  db,
  telemetry: createTelemetry(db),
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: async () => active,
});

const { config } = TEST_CONFIG;
const WORLD = randomUUID();
const SLUGS = [
  'kalliste',
  'elaia',
  'ampelos',
  'halos',
  'dikaia',
  'gamelia',
  'delphis',
  'agrotera',
  'phrourion',
  'myrrhine',
  'chalkeia',
  'emporion',
] as const;
type Slug = (typeof SLUGS)[number];
const CITY = Object.fromEntries(SLUGS.map((slug) => [slug, randomUUID()])) as Record<Slug, string>;
const GRANT = config.starting.grantOboles;
const COST = config.sites.acquisitionCostOboles;
const cycleMs = (recipeId: string) =>
  (config.recipes.find((recipe) => recipe.id === recipeId)?.durationMinutes ?? 0) * 60_000;

/** Une variante de la configuration de test, publiée sous un autre identifiant. */
const variant = (changes: Partial<GameConfig>): LoadedConfig => ({
  id: randomUUID(),
  number: 2,
  config: { ...config, ...changes },
});
const withCity = (slug: Slug, change: (city: GameConfig['cities'][number]) => object) =>
  config.cities.map((city) => (city.id === slug ? { ...city, ...change(city) } : city));

beforeAll(async () => {
  await sql`insert into game.worlds (id, slug, name) values (${WORLD}, ${`q-${WORLD.slice(0, 12)}`}, 'Douze cités')`.execute(
    owner,
  );
  for (const slug of SLUGS)
    await sql`insert into game.cities (id, world_id, slug, name) values (${CITY[slug]}, ${WORLD}, ${slug}, ${slug})`.execute(
      owner,
    );
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
// Chaque test part de la configuration de test, même si le précédent a échoué sur une variante.
beforeEach(() => {
  active = TEST_CONFIG;
});

interface Reply {
  status: number;
  // Les formes exactes sont vérifiées champ par champ dans les tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string } };
  replayed: string | null;
}
const send = async (user: string, command: string, body: unknown, key = randomUUID()) => {
  const res = await app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as Reply['body'],
    replayed: res.headers.get('Idempotent-Replay'),
  };
};
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

/** Fonde une maison dans la cité par la commande réelle ; rend son premier site. */
async function newPlayer(slug: Slug) {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const founded = await send(user, 'house.create', {
    cityId: CITY[slug],
    name: `Cité ${letters()}`,
    blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
  });
  expect(founded.status).toBe(200);
  const houseId = founded.body.data.houseId as string;
  const site = await db
    .selectFrom('game.sites')
    .select('id')
    .where('house_id', '=', houseId)
    .executeTakeFirstOrThrow();
  return { user, houseId, siteId: site.id, founded };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

/** Trésorerie, sites, écritures et événements de la maison : rien ne doit bouger après un refus. */
async function stateOf({ houseId }: Player) {
  const balance = await db
    .selectFrom('game.accounts')
    .select('balance')
    .where('house_id', '=', houseId)
    .executeTakeFirstOrThrow();
  const sites = await db
    .selectFrom('game.sites')
    .select(['id', 'recipe_id', 'cycle_started_at', 'halted_at'])
    .where('house_id', '=', houseId)
    .orderBy('id')
    .execute();
  const entries = await db
    .selectFrom('game.ledger_entries')
    .select('kind')
    .where(sql<boolean>`meta->>'houseId' = ${houseId}`)
    .orderBy('id')
    .execute();
  const events = await db
    .selectFrom('game.domain_events')
    .select('type')
    .where(sql<boolean>`payload->>'houseId' = ${houseId}`)
    .orderBy('id')
    .execute();
  return {
    balance: Number(balance.balance),
    sites,
    entries: entries.map((entry) => entry.kind),
    events: events.map((event) => event.type),
  };
}

/** Antidate le cycle du site (et son arrêt), garde des sites levée le temps de l'écriture. */
async function backdate(siteId: string, ms: number, halted = false) {
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = created_at - ${`${ms} milliseconds`}::interval,
      cycle_started_at = cycle_started_at - ${`${ms} milliseconds`}::interval,
      halted_at = case when ${halted} then now() else null end
      where id = ${siteId}`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}

describe('douze cités : terroir et recette de départ (6.1)', () => {
  it('fonde une maison dans chacune des douze cités, avec la recette de départ de sa cité', async () => {
    const founded = [];
    for (const slug of SLUGS) {
      const player = await newPlayer(slug);
      const state = await stateOf(player);
      founded.push([
        slug,
        player.founded.body.data.cityId,
        state.balance,
        state.sites.map((site) => site.recipe_id),
      ]);
    }
    expect(founded).toEqual([
      ['kalliste', CITY.kalliste, GRANT, ['grow_wheat']],
      ['elaia', CITY.elaia, GRANT, ['grow_wheat']],
      ['ampelos', CITY.ampelos, GRANT, ['grow_grapes']],
      ['halos', CITY.halos, GRANT, ['catch_fish']],
      ['dikaia', CITY.dikaia, GRANT, ['grow_wheat']],
      ['gamelia', CITY.gamelia, GRANT, ['grow_wheat']],
      ['delphis', CITY.delphis, GRANT, ['grow_olives']],
      ['agrotera', CITY.agrotera, GRANT, ['fell_wood']],
      ['phrourion', CITY.phrourion, GRANT, ['grow_wheat']],
      ['myrrhine', CITY.myrrhine, GRANT, ['grow_grapes']],
      ['chalkeia', CITY.chalkeia, GRANT, ['fell_wood']],
      ['emporion', CITY.emporion, GRANT, ['catch_fish']],
    ]);
  });

  it('une cité de #706 admet son terroir et refuse le reste, sans rien prélever', async () => {
    // Emporion, la cité d'Hermès : poisson, sel, olives et laine, pas de blé.
    const player = await newPlayer('emporion');
    const before = await stateOf(player);
    expect(await send(player.user, 'site.acquire', { recipeId: 'grow_wheat' })).toMatchObject({
      status: 409,
      body: { error: { code: 'RECIPE_NOT_IN_TERROIR' } },
    });
    expect(await stateOf(player)).toEqual(before);
    expect(await send(player.user, 'site.acquire', { recipeId: 'rake_salt' })).toMatchObject({
      status: 200,
      body: { data: { recipeId: 'rake_salt' } },
    });
  });

  it('une cité inconnue de la configuration reçoit la recette de départ commune', async () => {
    active = variant({ cities: config.cities.filter((city) => city.id !== 'halos') });
    const player = await newPlayer('halos');
    expect((await stateOf(player)).sites.map((site) => site.recipe_id)).toEqual([
      config.starting.siteRecipeId,
    ]);
  });

  it('refuse une acquisition hors terroir sans rien prélever, même rejouée ; admet terroir et atelier', async () => {
    const player = await newPlayer('ampelos');
    const before = await stateOf(player);
    const key = randomUUID();
    const refused = await send(player.user, 'site.acquire', { recipeId: 'grow_wheat' }, key);
    expect(refused).toMatchObject({
      status: 409,
      body: { ok: false, error: { code: 'RECIPE_NOT_IN_TERROIR' } },
      replayed: 'false',
    });
    // Même clé : le refus est rejoué, et toujours rien n'est payé.
    const replay = await send(player.user, 'site.acquire', { recipeId: 'grow_wheat' }, key);
    expect([replay.status, replay.replayed, replay.body]).toEqual([409, 'true', refused.body]);
    expect(await stateOf(player)).toEqual(before);

    // Le prix vu n'y change rien : le terroir est vérifié avant lui.
    expect(
      await send(player.user, 'site.acquire', { recipeId: 'grow_olives', expectedCostOboles: 1 }),
    ).toMatchObject({ status: 409, body: { error: { code: 'RECIPE_NOT_IN_TERROIR' } } });
    expect(await stateOf(player)).toEqual(before);

    // Un atelier est admis partout ; une production du terroir aussi.
    for (const recipeId of ['mill_flour', 'catch_fish'])
      expect(await send(player.user, 'site.acquire', { recipeId })).toMatchObject({
        status: 200,
        body: { data: { recipeId } },
      });
    const after = await stateOf(player);
    expect(after.balance).toBe(GRANT - COST.workshop - COST.fishery);
    expect(after.sites.map((site) => site.recipe_id).sort()).toEqual([
      'catch_fish',
      'grow_grapes',
      'mill_flour',
    ]);
  });

  it('refuse un changement de recette hors terroir, même rejoué ; le site garde sa recette et son cycle', async () => {
    const ampelos = await newPlayer('ampelos');
    const before = await stateOf(ampelos);
    // Verger : les olives sont du même type que le raisin, mais pas du terroir d'Ampelos.
    const olives = { siteId: ampelos.siteId, recipeId: 'grow_olives' };
    const key = randomUUID();
    const refused = await send(ampelos.user, 'site.setRecipe', olives, key);
    expect(refused).toMatchObject({
      status: 409,
      body: { ok: false, error: { code: 'RECIPE_NOT_IN_TERROIR' } },
      replayed: 'false',
    });
    expect(await stateOf(ampelos)).toEqual(before);
    // Même clé, même après une version qui admet les olives à Ampelos : le refus est rejoué tel quel.
    active = variant({
      cities: withCity('ampelos', (city) => ({
        terroir: [...(city.terroir ?? []), 'grow_olives'],
      })),
    });
    const replay = await send(ampelos.user, 'site.setRecipe', olives, key);
    expect([replay.status, replay.replayed, replay.body]).toEqual([409, 'true', refused.body]);
    expect(await stateOf(ampelos)).toEqual(before);
    // Une clé neuve est une nouvelle demande, jugée sous la version en vigueur.
    expect(await send(ampelos.user, 'site.setRecipe', olives)).toMatchObject({ status: 200 });
    // Pêcherie de Halos : le sel est de son terroir.
    const halos = await newPlayer('halos');
    expect(
      await send(halos.user, 'site.setRecipe', { siteId: halos.siteId, recipeId: 'rake_salt' }),
    ).toMatchObject({ status: 200, body: { data: { recipeId: 'rake_salt' } } });
  });

  it('un site existant hors terroir continue de tourner : il se récolte, mais n’y revient pas', async () => {
    // Une première version admet le raisin à Elaia ; la suivante resserre son terroir.
    active = variant({
      cities: withCity('elaia', (city) => ({ terroir: [...(city.terroir ?? []), 'grow_grapes'] })),
    });
    const player = await newPlayer('elaia');
    const acquired = await send(player.user, 'site.acquire', { recipeId: 'grow_grapes' });
    expect(acquired.status).toBe(200);
    const siteId = acquired.body.data.siteId as string;
    active = TEST_CONFIG;
    await backdate(siteId, cycleMs('grow_grapes'));
    const collected = await send(player.user, 'site.collect', { siteId });
    expect(collected).toMatchObject({ status: 200, body: { data: { cycles: 1 } } });
    const grapes = await db
      .selectFrom('game.inventories')
      .select('quantity')
      .where('house_id', '=', player.houseId)
      .where('good_id', '=', 'grapes')
      .executeTakeFirstOrThrow();
    expect(Number(grapes.quantity)).toBeGreaterThan(0);
    // Il peut passer aux olives, du terroir, mais pas revenir au raisin.
    expect(
      await send(player.user, 'site.setRecipe', { siteId, recipeId: 'grow_olives' }),
    ).toMatchObject({ status: 200 });
    expect(
      await send(player.user, 'site.setRecipe', { siteId, recipeId: 'grow_grapes' }),
    ).toMatchObject({ status: 409, body: { error: { code: 'RECIPE_NOT_IN_TERROIR' } } });
  });

  it('un site sans recette, à l’arrêt, n’est pas relancé pour une recette hors terroir', async () => {
    const player = await newPlayer('ampelos');
    await backdate(player.siteId, cycleMs('grow_grapes'), true);
    // La recette du raisin est retirée (renommée) : le site n'a plus de type, il peut tout adopter…
    const grapes = config.recipes.find((recipe) => recipe.id === 'grow_grapes');
    if (!grapes) throw new Error('grow_grapes missing from the test configuration');
    const renamed = { ...grapes, id: 'grow_grapes_v2' };
    active = variant({
      recipes: [...config.recipes.filter((recipe) => recipe.id !== 'grow_grapes'), renamed],
      cities: config.cities.map((city) => ({
        ...city,
        terroir: city.terroir?.map((id) => (id === 'grow_grapes' ? renamed.id : id)),
        startingRecipeId:
          city.startingRecipeId === 'grow_grapes' ? renamed.id : city.startingRecipeId,
      })),
    });
    const before = await stateOf(player);
    expect(before.sites[0]?.halted_at).not.toBeNull();
    // …sauf ce que le terroir refuse : ni relance gratuite, ni événement, ni changement.
    expect(
      await send(player.user, 'site.setRecipe', { siteId: player.siteId, recipeId: 'grow_wheat' }),
    ).toMatchObject({ status: 409, body: { error: { code: 'RECIPE_NOT_IN_TERROIR' } } });
    expect(await stateOf(player)).toEqual(before);
    expect(
      await send(player.user, 'site.setRecipe', { siteId: player.siteId, recipeId: renamed.id }),
    ).toMatchObject({ status: 200 });
    const after = await stateOf(player);
    expect([after.sites[0]?.recipe_id, after.sites[0]?.halted_at]).toEqual([renamed.id, null]);
    // Relance sans frais puis changement, dans la même transaction (ordre des identifiants indifférent).
    expect(after.events.slice(before.events.length).sort()).toEqual([
      'SiteRecipeChanged',
      'SiteRestarted',
    ]);
  });
});
