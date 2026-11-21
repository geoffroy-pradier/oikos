import { randomUUID } from 'node:crypto';
import { createConfigLoader, publishVersion, type LoadedConfig } from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testVerifier } from './test-config';

// Recette retirée de la configuration alors qu'un site l'exploite (ticket 97 ; 4.2 et 5.5), contre
// Supabase local. Une version sans la recette du champ de départ est publiée, puis lue comme le fait
// l'API ; l'activer dans la base partagée changerait la configuration de toutes les autres suites, et
// de l'API des tests de bout en bout : l'API de ce fichier passe donc d'une version à l'autre.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
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
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const { config } = TEST_CONFIG;
const RETIRED = config.starting.siteRecipeId;
const field = config.recipes.find((recipe) => recipe.id === RETIRED);
if (!field?.outputs[0]) throw new Error('starting recipe missing from the test configuration');
const CYCLE_MS = field.durationMinutes * 60_000;
const WHEAT = field.outputs[0];
/** La même production sous un autre identifiant : le cas d'une recette renommée par le back-office. */
const REPLACEMENT = { ...field, id: `${RETIRED}_v2` };
/** Les clés d'une table par recette, la recette retirée sous son nouvel identifiant. */
const renamed = <T>(byRecipe: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(byRecipe).map(([id, value]) => [id === RETIRED ? REPLACEMENT.id : id, value]),
  );
let retired: LoadedConfig;
beforeAll(async () => {
  const published = await publishVersion(
    db,
    {
      ...config,
      recipes: [...config.recipes.filter((recipe) => recipe.id !== RETIRED), REPLACEMENT],
      starting: { ...config.starting, siteRecipeId: REPLACEMENT.id },
      // Le schéma refuse un terroir qui cite une recette inconnue : le renommage y est reporté.
      cities: config.cities.map((city) => ({
        ...city,
        terroir: city.terroir?.map((id) => (id === RETIRED ? REPLACEMENT.id : id)),
      })),
      // De même pour les filières des maisons PNJ de secours (#717), leurs sites et leurs règles par recette.
      npcHouses: Object.fromEntries(
        Object.entries(config.npcHouses).map(([slug, city]) => [
          slug,
          {
            ...city,
            chains: city.chains.map((chain) => ({
              ...chain,
              sites: renamed(chain.sites),
              ...(chain.rules && { rules: renamed(chain.rules) }),
            })),
          },
        ]),
      ),
    },
    { note: 'test : recette du champ de départ retirée (ticket 97)' },
  );
  // La publication n'est pas refusée : retirer une recette exploitée reste possible (4.2).
  if (!published.ok) throw new Error(published.errors.join('\n'));
  retired = await createConfigLoader(db).byId(published.version.id);
});

interface Reply {
  status: number;
  // Les formes exactes sont vérifiées champ par champ dans les tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { data?: any; error?: { code: string } };
  replayed: string | null;
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
  return {
    status: res.status,
    body: (await res.json()) as Reply['body'],
    replayed: res.headers.get('Idempotent-Replay'),
  };
};
const collect = (user: string, siteId: string) => send(user, 'site.collect', { siteId });
const setRecipe = (user: string, siteId: string, recipeId: string, key?: string) =>
  send(user, 'site.setRecipe', { siteId, recipeId }, key);

/**
 * Une maison fondée sous la configuration de test : son champ exploite la recette qui sera retirée.
 * Le cycle en cours a `cycles` cycles d'âge ; avec `haltedCycles`, le site est à l'arrêt depuis ce
 * nombre de cycles. La configuration sans la recette entre ensuite en vigueur pour l'API.
 */
async function siteOfRetiredRecipe(cycles: number, haltedCycles?: number) {
  active = TEST_CONFIG;
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const founded = await send(user, 'house.create', {
    cityId: '01900000-0000-7000-8000-000000000101',
    name: `Retrait ${[...user.replace(/[^a-f]/g, '')].slice(0, 10).join('')}`,
    blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
  });
  const houseId = (founded.body.data as { houseId: string }).houseId;
  const site = await db
    .selectFrom('game.sites')
    .select(['id', 'recipe_id'])
    .where('house_id', '=', houseId)
    .executeTakeFirstOrThrow();
  expect(site.recipe_id).toBe(RETIRED);
  const ms = (count: number) => `${count * CYCLE_MS} milliseconds`;
  // Garde des sites levée le temps d'antidater la création, le cycle et l'arrêt.
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = now() - ${ms(cycles)}::interval,
      cycle_started_at = now() - ${ms(cycles)}::interval,
      halted_at = now() - ${haltedCycles === undefined ? null : ms(haltedCycles)}::interval
      where id = ${site.id}`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
  active = retired;
  return { user, houseId, siteId: site.id };
}
type Player = Awaited<ReturnType<typeof siteOfRetiredRecipe>>;

/** Recette, arrêt, âge du cycle en secondes, stock, trésorerie et écritures de la maison, dotation à part. */
async function stateOf({ houseId, siteId }: Player) {
  const site = await db
    .selectFrom('game.sites')
    .select(['recipe_id', 'halted_at'])
    .select(sql<string>`extract(epoch from now() - cycle_started_at)`.as('age'))
    .where('id', '=', siteId)
    .executeTakeFirstOrThrow();
  const stock = await db
    .selectFrom('game.inventories')
    .select(['good_id', 'quantity'])
    .where('house_id', '=', houseId)
    .execute();
  const account = await db
    .selectFrom('game.accounts')
    .select(['balance'])
    .where('house_id', '=', houseId)
    .where('kind', '=', 'house')
    .executeTakeFirstOrThrow();
  const entries = await sql<{ kind: string }>`select distinct e.kind from game.ledger_entries e
    join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
    where a.house_id = ${houseId} and e.kind <> 'house.starting_grant' order by e.kind`.execute(db);
  return {
    recipeId: site.recipe_id,
    halted: site.halted_at !== null,
    ageSeconds: Number(site.age),
    stock: stock.map((row) => [row.good_id, Number(row.quantity)]),
    balance: Number(account.balance),
    entries: entries.rows.map((row) => row.kind),
  };
}
const eventsOf = async ({ siteId }: Player) =>
  (
    await db
      .selectFrom('game.domain_events')
      .select(['type', 'payload'])
      .where(sql<boolean>`payload->>'siteId' = ${siteId}`)
      .orderBy('seq')
      .execute()
  ).map((event) => ({ type: event.type, payload: event.payload }));
const GRANT = config.starting.grantOboles;

describe('site dont la recette a quitté la configuration', () => {
  it('ne se récolte plus, même plein, et rien n’est écrit ; ce n’est pas une erreur interne', async () => {
    const player = await siteOfRetiredRecipe(field.maxAccruedCycles + 1);
    const before = await stateOf(player);
    expect(await collect(player.user, player.siteId)).toMatchObject({
      status: 409,
      body: { error: { code: 'RECIPE_RETIRED' } },
    });
    const after = await stateOf(player);
    expect(after).toMatchObject({ recipeId: RETIRED, stock: [], balance: GRANT, entries: [] });
    expect(after.ageSeconds).toBeGreaterThanOrEqual(before.ageSeconds);
    expect(await eventsOf(player)).toEqual([]);
  });

  it('à l’arrêt : ne se récolte pas non plus (pas même ce qu’il avait accumulé avant l’arrêt)', async () => {
    const player = await siteOfRetiredRecipe(5, 1);
    expect(await collect(player.user, player.siteId)).toMatchObject({
      status: 409,
      body: { error: { code: 'RECIPE_RETIRED' } },
    });
    expect(await stateOf(player)).toMatchObject({ halted: true, stock: [], entries: [] });
  });

  it('change de recette sans récolte préalable : la production accumulée est perdue, le nouveau cycle commence maintenant et se récolte', async () => {
    const player = await siteOfRetiredRecipe(3);
    const key = randomUUID();
    const changed = await setRecipe(player.user, player.siteId, REPLACEMENT.id, key);
    expect(changed).toMatchObject({
      status: 200,
      replayed: 'false',
      body: { data: { siteId: player.siteId, recipeId: REPLACEMENT.id } },
    });
    const after = await stateOf(player);
    expect(after).toMatchObject({ recipeId: REPLACEMENT.id, halted: false, stock: [] });
    expect(after.ageSeconds).toBeLessThan(60);
    // Rejouée avec sa clé, la commande rend la même réponse sans second changement.
    expect(await setRecipe(player.user, player.siteId, REPLACEMENT.id, key)).toMatchObject({
      status: 200,
      replayed: 'true',
      body: changed.body,
    });
    expect(await eventsOf(player)).toEqual([
      {
        type: 'SiteRecipeChanged',
        payload: {
          siteId: player.siteId,
          houseId: player.houseId,
          previousRecipeId: RETIRED,
          recipeId: REPLACEMENT.id,
        },
      },
    ]);

    // La nouvelle recette produit normalement : deux cycles plus tard, deux cycles se récoltent.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
      await sql`update game.sites set cycle_started_at = cycle_started_at - ${`${2 * CYCLE_MS} milliseconds`}::interval
        where id = ${player.siteId}`.execute(trx);
      await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    });
    expect(await collect(player.user, player.siteId)).toMatchObject({
      status: 200,
      body: {
        data: { cycles: 2, outputs: [{ goodId: WHEAT.goodId, quantity: 2 * WHEAT.quantity }] },
      },
    });
  });

  it('n’a plus de type : peut adopter une recette de n’importe quel type, mais pas la recette retirée', async () => {
    const player = await siteOfRetiredRecipe(1);
    expect(await setRecipe(player.user, player.siteId, RETIRED)).toMatchObject({
      status: 404,
      body: { error: { code: 'RECIPE_NOT_FOUND' } },
    });
    expect(await setRecipe(player.user, player.siteId, 'mill_flour')).toMatchObject({
      status: 200,
      body: { data: { recipeId: 'mill_flour' } },
    });
    // Le site a de nouveau un type : celui de l'atelier, avec ses règles ordinaires.
    expect(await setRecipe(player.user, player.siteId, REPLACEMENT.id)).toMatchObject({
      status: 409,
      body: { error: { code: 'RECIPE_NOT_COMPATIBLE' } },
    });
  });

  it('à l’arrêt : change de recette et repart sans rien payer, comme le ferait une relance', async () => {
    const player = await siteOfRetiredRecipe(5, 2);
    expect(await setRecipe(player.user, player.siteId, REPLACEMENT.id)).toMatchObject({
      status: 200,
      body: { data: { recipeId: REPLACEMENT.id } },
    });
    const after = await stateOf(player);
    expect(after).toMatchObject({
      recipeId: REPLACEMENT.id,
      halted: false,
      balance: GRANT,
      entries: [],
    });
    expect(after.ageSeconds).toBeLessThan(60);
    expect((await eventsOf(player)).map((event) => event.type)).toEqual([
      'SiteRestarted',
      'SiteRecipeChanged',
    ]);
    expect((await eventsOf(player))[0]?.payload).toMatchObject({ upkeepOboles: 0 });
  });

  it('arrêté par une clôture commencée après la commande : conflit à rejouer, pas une erreur interne', async () => {
    // L'arrêt est postérieur à l'instant de la commande (ici, dans un cycle) : le lever ferait reculer
    // le cycle, ce que la garde de la base refuse.
    const player = await siteOfRetiredRecipe(3, -1);
    expect(await setRecipe(player.user, player.siteId, REPLACEMENT.id)).toMatchObject({
      status: 409,
      body: { error: { code: 'SITE_CHANGED' } },
    });
    expect(await stateOf(player)).toMatchObject({ recipeId: RETIRED, halted: true });
  });

  it('refuse le site d’un autre joueur comme un site inconnu, et l’acquisition de la recette retirée', async () => {
    const [player, other] = [await siteOfRetiredRecipe(1), await siteOfRetiredRecipe(1)];
    for (const reply of [
      await setRecipe(other.user, player.siteId, REPLACEMENT.id),
      await collect(other.user, player.siteId),
    ])
      expect(reply).toMatchObject({ status: 404, body: { error: { code: 'SITE_NOT_FOUND' } } });
    expect(await send(player.user, 'site.acquire', { recipeId: RETIRED })).toMatchObject({
      status: 404,
      body: { error: { code: 'RECIPE_NOT_FOUND' } },
    });
    expect(await stateOf(player)).toMatchObject({ recipeId: RETIRED, balance: GRANT });
  });

  it('commandes simultanées sur le même site : un seul changement, aucun refus en erreur interne', async () => {
    const player = await siteOfRetiredRecipe(3, 1);
    const replies = await Promise.all([
      setRecipe(player.user, player.siteId, REPLACEMENT.id),
      setRecipe(player.user, player.siteId, REPLACEMENT.id),
      collect(player.user, player.siteId),
      send(player.user, 'site.restart', { siteId: player.siteId }),
    ]);
    for (const reply of replies) expect([200, 409]).toContain(reply.status);
    const [first, second] = replies;
    expect([first?.status, second?.status].filter((status) => status === 200)).toHaveLength(1);
    // Le perdant constate le changement (`SITE_CHANGED`) ou la recette déjà adoptée.
    expect(
      [first, second].filter((reply) => reply?.status === 409).map((r) => r?.body.error?.code),
    ).toEqual([expect.stringMatching(/^(SITE_CHANGED|RECIPE_UNCHANGED)$/)]);
    const after = await stateOf(player);
    expect(after).toMatchObject({ recipeId: REPLACEMENT.id, halted: false, balance: GRANT });
    expect(after.entries).toEqual([]);
    const changes = (await eventsOf(player)).filter((event) => event.type === 'SiteRecipeChanged');
    expect(changes).toHaveLength(1);
  });
});
