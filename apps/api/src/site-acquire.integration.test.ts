import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Acquisition d'un site et changement de recette, contre Supabase local. Chaque test fonde sa maison.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const app = createApp({
  db,
  telemetry: createTelemetry(db),
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const { sites, starting, recipes } = TEST_CONFIG.config;
const GRANT = starting.grantOboles;
const COST = sites.acquisitionCostOboles;
const LIMIT = sites.limitByHeadquartersLevel[0] ?? 0;
const recipe = (id: string) => {
  const found = recipes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`recipe ${id} missing from the test configuration`);
  return found;
};
const CITY = '01900000-0000-7000-8000-000000000101';
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

interface Reply {
  status: number;
  // Les formes exactes sont vérifiées champ par champ dans les tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string; message: string } };
}
const send = async (
  user: string,
  command: string,
  body: unknown,
  key: string = randomUUID(),
): Promise<Reply> => {
  const res = await app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Reply['body'] };
};
async function newUser() {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  return user;
}
/** Fonde une maison par la commande réelle : elle reçoit sa dotation et son premier champ. */
async function newPlayer() {
  const user = await newUser();
  const founded = await send(user, 'house.create', {
    cityId: CITY,
    name: `Domaine ${letters()}`,
    blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
  });
  return { user, houseId: founded.body.data.houseId as string };
}
const acquire = (user: string, recipeId: string, key?: string) =>
  send(user, 'site.acquire', { recipeId }, key);
const setRecipe = (user: string, siteId: string, recipeId: string, key?: string) =>
  send(user, 'site.setRecipe', { siteId, recipeId }, key);
const sitesOf = async (houseId: string) =>
  (
    await db
      .selectFrom('game.sites')
      .select(['id', 'recipe_id', 'city_id'])
      .where('house_id', '=', houseId)
      // Identifiants ordonnés dans le temps : l'ordre d'acquisition, même après un vieillissement de test.
      .orderBy('id')
      .execute()
  ).map((site) => site.recipe_id);
const balanceOf = async (houseId: string) =>
  Number(
    (
      await db
        .selectFrom('game.accounts')
        .select('balance')
        .where('house_id', '=', houseId)
        .where('kind', '=', 'house')
        .executeTakeFirstOrThrow()
    ).balance,
  );
const eventsOf = async (houseId: string, type: string) =>
  (
    await db
      .selectFrom('game.domain_events')
      .select('payload')
      .where(sql<boolean>`payload->>'houseId' = ${houseId}`)
      .where('type', '=', type)
      .orderBy('seq')
      .execute()
  ).map((event) => event.payload as Record<string, unknown>);
/** Fait vieillir le cycle en cours : la garde de la base interdit l'antidatage, levée ici le temps du test. */
async function age(siteId: string, minutes: number) {
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = created_at - ${`${minutes} minutes`}::interval,
      cycle_started_at = cycle_started_at - ${`${minutes} minutes`}::interval where id = ${siteId}`.execute(
      trx,
    );
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}
const stockOf = async (houseId: string) =>
  Object.fromEntries(
    (
      await db
        .selectFrom('game.inventories')
        .select(['good_id', 'quantity'])
        .where('house_id', '=', houseId)
        .execute()
    ).map((row) => [row.good_id, Number(row.quantity)]),
  );

describe('site.acquire', () => {
  it('la maison paie le prix du type de site, détruit par le puits, et reçoit un site dans sa cité', async () => {
    const player = await newPlayer();
    const key = randomUUID();
    const bought = await acquire(player.user, 'grow_olives', key);
    expect(bought).toMatchObject({
      status: 200,
      body: { data: { recipeId: 'grow_olives', siteType: 'orchard', costOboles: COST.orchard } },
    });
    const siteId = bought.body.data.siteId as string;
    expect(await sitesOf(player.houseId)).toEqual(['grow_wheat', 'grow_olives']);
    expect(await balanceOf(player.houseId)).toBe(GRANT - COST.orchard);
    // L'écriture est équilibrée : la maison est débitée, le puits d'acquisition crédité.
    const lines = await sql<{ key: string | null; amount: string }>`
      select a.system_key as key, l.amount from game.ledger_lines l
      join game.ledger_entries e on e.id = l.entry_id join game.accounts a on a.id = l.account_id
      where e.kind = 'site.acquire' and e.meta->>'siteId' = ${siteId} order by l.amount`.execute(
      owner,
    );
    expect(lines.rows).toEqual([
      { key: null, amount: String(-COST.orchard) },
      { key: 'sink_site_acquisition', amount: String(COST.orchard) },
    ]);
    expect(await eventsOf(player.houseId, 'SiteAcquired')).toEqual([
      {
        siteId,
        houseId: player.houseId,
        cityId: CITY,
        recipeId: 'grow_olives',
        siteType: 'orchard',
        costOboles: COST.orchard,
      },
    ]);
    // Rejeu de la même clé : même réponse, ni second site ni second paiement.
    expect(await acquire(player.user, 'grow_olives', key)).toEqual(bought);
    expect(await sitesOf(player.houseId)).toHaveLength(2);
    expect(await balanceOf(player.houseId)).toBe(GRANT - COST.orchard);

    // Le site acquis produit comme tout autre.
    await age(siteId, recipe('grow_olives').durationMinutes);
    expect((await send(player.user, 'site.collect', { siteId })).status).toBe(200);
    expect(await stockOf(player.houseId)).toEqual({
      olives: recipe('grow_olives').outputs[0]?.quantity,
    });
  });

  it('le nombre de sites est borné par le niveau du siège', async () => {
    const player = await newPlayer();
    expect(LIMIT).toBe(4);
    for (let owned = 1; owned < LIMIT; owned += 1)
      expect((await acquire(player.user, 'grow_wheat')).status).toBe(200);
    const paid = (LIMIT - 1) * COST.field;
    expect(await acquire(player.user, 'grow_wheat')).toMatchObject({
      status: 409,
      body: { error: { code: 'SITE_LIMIT_REACHED' } },
    });
    expect(await sitesOf(player.houseId)).toHaveLength(LIMIT);
    expect(await balanceOf(player.houseId)).toBe(GRANT - paid);
  });

  it('trésorerie insuffisante : refus, rien ne bouge, jamais de solde négatif', async () => {
    const player = await newPlayer();
    // Deux carrières à 1 200 oboles laissent 600 : pas de quoi en payer une troisième.
    expect(COST.quarry * 2).toBeLessThanOrEqual(GRANT);
    expect(COST.quarry * 3).toBeGreaterThan(GRANT);
    await acquire(player.user, 'dig_clay');
    await acquire(player.user, 'dig_clay');
    expect(await acquire(player.user, 'dig_clay')).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_FUNDS' } },
    });
    expect(await sitesOf(player.houseId)).toEqual(['grow_wheat', 'dig_clay', 'dig_clay']);
    expect(await balanceOf(player.houseId)).toBe(GRANT - 2 * COST.quarry);
    // Un site moins cher reste accessible.
    expect((await acquire(player.user, 'grow_wheat')).status).toBe(200);
    expect(await balanceOf(player.houseId)).toBe(GRANT - 2 * COST.quarry - COST.field);
  });

  it('recette inconnue, compte sans maison : refus sans effet', async () => {
    const player = await newPlayer();
    expect(await acquire(player.user, 'grow_gold')).toMatchObject({
      status: 404,
      body: { error: { code: 'RECIPE_NOT_FOUND' } },
    });
    expect((await acquire(player.user, 'Bad Recipe')).status).toBe(400);
    expect(await acquire(await newUser(), 'grow_wheat')).toMatchObject({
      status: 404,
      body: { error: { code: 'HOUSE_NOT_FOUND' } },
    });
    expect(await sitesOf(player.houseId)).toEqual(['grow_wheat']);
    expect(await balanceOf(player.houseId)).toBe(GRANT);
    expect(await eventsOf(player.houseId, 'SiteAcquired')).toEqual([]);
  });

  // Plusieurs maisons : sans le verrou, une course isolée passe parfois par chance.
  it('acquisitions simultanées à la limite : une seule passe', async () => {
    const players = await Promise.all(Array.from({ length: 6 }, () => newPlayer()));
    await Promise.all(
      players.map(async (player) => {
        for (let owned = 1; owned < LIMIT - 1; owned += 1) await acquire(player.user, 'grow_wheat');
        const before = await balanceOf(player.houseId);
        const outcomes = await Promise.all(
          Array.from({ length: 4 }, () => acquire(player.user, 'grow_wheat')),
        );
        expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([200, 409, 409, 409]);
        expect(
          outcomes.filter((outcome) => outcome.body.error?.code === 'SITE_LIMIT_REACHED'),
        ).toHaveLength(3);
        expect(await sitesOf(player.houseId)).toHaveLength(LIMIT);
        expect(await balanceOf(player.houseId)).toBe(before - COST.field);
      }),
    );
  });

  it('acquisition et achats à l’agora simultanés : aucun interblocage', async () => {
    // Un achat verrouille le compte puis touche la maison (clé étrangère de l'ordre) ; l'acquisition
    // verrouille la maison puis le compte. Carnet sans vente : chaque achat attend, une obole retenue.
    const players = await Promise.all(Array.from({ length: 20 }, () => newPlayer()));
    const buy = (user: string) =>
      send(user, 'market.placeOrder', {
        cityId: CITY,
        goodId: 'amphorae',
        side: 'buy',
        price: 1,
        quantity: 1,
      });
    const outcomes = await Promise.all(
      players.flatMap((player) => [
        buy(player.user),
        acquire(player.user, 'grow_wheat'),
        buy(player.user),
        acquire(player.user, 'grow_wheat'),
      ]),
    );
    expect(outcomes.map((outcome) => outcome.status).filter((status) => status !== 200)).toEqual(
      [],
    );
    for (const player of players) {
      expect(await sitesOf(player.houseId)).toHaveLength(3);
      expect(await balanceOf(player.houseId)).toBe(GRANT - 2 * COST.field - 2);
    }
  });

  it('acquisitions simultanées avec de quoi en payer une seule : une seule passe, solde jamais négatif', async () => {
    const player = await newPlayer();
    await acquire(player.user, 'dig_clay');
    // Reste 1 800 : une carrière de plus, pas deux.
    const outcomes = await Promise.all([
      acquire(player.user, 'dig_clay'),
      acquire(player.user, 'dig_clay'),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([200, 409]);
    expect(outcomes.find((outcome) => outcome.status === 409)?.body.error?.code).toBe(
      'INSUFFICIENT_FUNDS',
    );
    expect(await balanceOf(player.houseId)).toBe(GRANT - 2 * COST.quarry);
    expect(await sitesOf(player.houseId)).toHaveLength(3);
  });
});

describe('site.setRecipe', () => {
  /** Une maison avec un verger d'oliviers. */
  async function withOrchard() {
    const player = await newPlayer();
    const siteId = (await acquire(player.user, 'grow_olives')).body.data.siteId as string;
    return { ...player, siteId };
  }
  const cycleOf = async (siteId: string) =>
    (
      await db
        .selectFrom('game.sites')
        .select(['recipe_id', 'cycle_started_at'])
        .where('id', '=', siteId)
        .executeTakeFirstOrThrow()
    ).cycle_started_at.getTime();

  it('change la recette parmi celles du même type ; le cycle entamé est perdu et repart maintenant', async () => {
    const player = await withOrchard();
    // Un demi-cycle d'olives est en cours : rien à récolter, le changement est permis.
    const half = recipe('grow_olives').durationMinutes / 2;
    await age(player.siteId, half);
    const before = Date.now();
    const key = randomUUID();
    const changed = await setRecipe(player.user, player.siteId, 'grow_grapes', key);
    expect(changed).toMatchObject({
      status: 200,
      body: { data: { siteId: player.siteId, recipeId: 'grow_grapes' } },
    });
    expect(await sitesOf(player.houseId)).toEqual(['grow_wheat', 'grow_grapes']);
    expect(await cycleOf(player.siteId)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(changed.body.data.cycleStartedAt as string)).toBe(
      await cycleOf(player.siteId),
    );
    expect(await eventsOf(player.houseId, 'SiteRecipeChanged')).toEqual([
      {
        siteId: player.siteId,
        houseId: player.houseId,
        previousRecipeId: 'grow_olives',
        recipeId: 'grow_grapes',
      },
    ]);
    expect(await setRecipe(player.user, player.siteId, 'grow_grapes', key)).toEqual(changed);
    // Le demi-cycle d'olives n'est pas devenu du raisin : rien à récolter avant un cycle entier.
    expect((await send(player.user, 'site.collect', { siteId: player.siteId })).body).toMatchObject(
      {
        error: { code: 'NOTHING_TO_COLLECT' },
      },
    );
    await age(player.siteId, recipe('grow_grapes').durationMinutes);
    expect((await send(player.user, 'site.collect', { siteId: player.siteId })).status).toBe(200);
    expect(await stockOf(player.houseId)).toEqual({
      grapes: recipe('grow_grapes').outputs[0]?.quantity,
    });
    // Changer de recette ne coûte rien.
    expect(await balanceOf(player.houseId)).toBe(GRANT - COST.orchard);
  });

  it('ce qui est déjà produit doit d’abord être récolté', async () => {
    const player = await withOrchard();
    // Un seul cycle entier suffit à bloquer le changement.
    await age(player.siteId, recipe('grow_olives').durationMinutes);
    expect((await setRecipe(player.user, player.siteId, 'grow_grapes')).body.error?.code).toBe(
      'COLLECT_FIRST',
    );
    await age(player.siteId, recipe('grow_olives').durationMinutes);
    expect(await setRecipe(player.user, player.siteId, 'grow_grapes')).toMatchObject({
      status: 409,
      body: { error: { code: 'COLLECT_FIRST' } },
    });
    expect(await sitesOf(player.houseId)).toEqual(['grow_wheat', 'grow_olives']);
    expect((await send(player.user, 'site.collect', { siteId: player.siteId })).status).toBe(200);
    expect((await setRecipe(player.user, player.siteId, 'grow_grapes')).status).toBe(200);
    expect(await stockOf(player.houseId)).toEqual({
      olives: 2 * (recipe('grow_olives').outputs[0]?.quantity ?? 0),
    });
  });

  it('un cycle avancé au-delà de l’instant de la commande : conflit à rejouer, pas une erreur interne', async () => {
    const player = await withOrchard();
    // Ce que laisse une collecte commencée après la commande et validée avant elle.
    await age(player.siteId, -1);
    expect(await setRecipe(player.user, player.siteId, 'grow_grapes')).toMatchObject({
      status: 409,
      body: { error: { code: 'SITE_CHANGED' } },
    });
    expect(await sitesOf(player.houseId)).toEqual(['grow_wheat', 'grow_olives']);
    await age(player.siteId, 1);
    expect((await setRecipe(player.user, player.siteId, 'grow_grapes')).status).toBe(200);
  });

  it('la production accumulée se compte avec la durée de la recette en cours, pas de la nouvelle', async () => {
    const [fish, salt] = [recipe('catch_fish'), recipe('rake_salt')];
    expect(fish.durationMinutes).toBeLessThan(salt.durationMinutes);
    const between = Math.floor((fish.durationMinutes + salt.durationMinutes) / 2);
    // Une pêcherie a fini un cycle de pêche : elle ne passe pas au sel sans récolte.
    const fisher = await newPlayer();
    const fishery = (await acquire(fisher.user, 'catch_fish')).body.data.siteId as string;
    await age(fishery, between);
    expect((await setRecipe(fisher.user, fishery, 'rake_salt')).body.error?.code).toBe(
      'COLLECT_FIRST',
    );
    // Une saline n'a pas fini son cycle, plus long : elle peut passer à la pêche.
    const salter = await newPlayer();
    const saltern = (await acquire(salter.user, 'rake_salt')).body.data.siteId as string;
    await age(saltern, between);
    expect((await setRecipe(salter.user, saltern, 'catch_fish')).status).toBe(200);
  });

  it('un atelier s’acquiert au prix de son type et change de recette parmi celles des ateliers', async () => {
    const player = await newPlayer();
    const bought = await acquire(player.user, 'mill_flour');
    expect(bought).toMatchObject({
      status: 200,
      body: { data: { siteType: 'workshop', costOboles: COST.workshop } },
    });
    const siteId = bought.body.data.siteId as string;
    expect((await setRecipe(player.user, siteId, 'bake_bread')).status).toBe(200);
    expect((await setRecipe(player.user, siteId, 'grow_wheat')).body.error?.code).toBe(
      'RECIPE_NOT_COMPATIBLE',
    );
    expect(await sitesOf(player.houseId)).toEqual(['grow_wheat', 'bake_bread']);
  });

  it('refuse une recette d’un autre type, inconnue ou inchangée', async () => {
    const player = await withOrchard();
    const attempt = async (recipeId: string) =>
      (await setRecipe(player.user, player.siteId, recipeId)).body.error?.code;
    expect(await attempt('grow_wheat')).toBe('RECIPE_NOT_COMPATIBLE');
    expect(await attempt('grow_gold')).toBe('RECIPE_NOT_FOUND');
    expect(await attempt('grow_olives')).toBe('RECIPE_UNCHANGED');
    expect(await attempt('mill_flour')).toBe('RECIPE_NOT_COMPATIBLE');
    expect(await sitesOf(player.houseId)).toEqual(['grow_wheat', 'grow_olives']);
    expect(await eventsOf(player.houseId, 'SiteRecipeChanged')).toEqual([]);
  });

  it("le site d'un autre joueur est indiscernable d'un site inexistant, et reste intact", async () => {
    const [player, other] = [await withOrchard(), await newPlayer()];
    const foreign = await setRecipe(other.user, player.siteId, 'grow_grapes');
    expect(foreign).toMatchObject({ status: 404, body: { error: { code: 'SITE_NOT_FOUND' } } });
    expect(await setRecipe(other.user, randomUUID(), 'grow_grapes')).toEqual(foreign);
    expect(await sitesOf(player.houseId)).toEqual(['grow_wheat', 'grow_olives']);
  });

  it('collecte et changement de recette simultanés : la production de l’ancienne recette n’est ni perdue ni convertie', async () => {
    const player = await withOrchard();
    const perCycle = recipe('grow_olives').outputs[0]?.quantity ?? 0;
    let [collectedFirst, changedFirst] = [0, 0];
    for (let round = 0; round < 8; round += 1) {
      const from = round % 2 === 0 ? 'grow_olives' : 'grow_grapes';
      const to = round % 2 === 0 ? 'grow_grapes' : 'grow_olives';
      await age(player.siteId, recipe(from).durationMinutes * 2);
      const [collected, changed] = await Promise.all([
        send(player.user, 'site.collect', { siteId: player.siteId }),
        setRecipe(player.user, player.siteId, to),
      ]);
      // La collecte passe toujours ; le changement passe après elle, ou est refusé avant elle.
      expect(collected).toMatchObject({ status: 200, body: { data: { cycles: 2 } } });
      if (changed.status === 200) collectedFirst += 1;
      else {
        expect(changed.body.error?.code).toBe('COLLECT_FIRST');
        changedFirst += 1;
        expect((await setRecipe(player.user, player.siteId, to)).status).toBe(200);
      }
    }
    expect(collectedFirst + changedFirst).toBe(8);
    // Quatre tours d'olives, quatre de raisin, deux cycles chacun, rien de plus.
    expect(await stockOf(player.houseId)).toEqual({ olives: 8 * perCycle, grapes: 8 * perCycle });
  });
});
