import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createTelemetry } from './telemetry';
import { unlimited } from './rate-limit';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Tests d'intégration de `site.collect` contre Supabase local. Le champ de départ vient de `house.create`.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const telemetry = createTelemetry(db);
const owner = createDb(DATABASE_URL);
const app = createApp({
  db,
  telemetry,
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: testConfig,
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const recipe = TEST_CONFIG.config.recipes.find(
  (candidate) => candidate.id === TEST_CONFIG.config.starting.siteRecipeId,
);
if (!recipe?.outputs[0]) throw new Error('starting recipe missing from the test configuration');
const CYCLE_MS = recipe.durationMinutes * 60_000;
const PER_CYCLE = recipe.outputs[0].quantity;
const GOOD = recipe.outputs[0].goodId;
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

const send = (user: string, command: string, body: unknown, key: string = randomUUID()) =>
  app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });

/** Fonde une maison par la commande réelle et rend son compte, sa maison et son champ. */
async function newPlayer() {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const founded = await send(user, 'house.create', {
    cityId: '01900000-0000-7000-8000-000000000101',
    name: `Champ ${letters()}`,
    blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
  });
  const { data } = (await founded.json()) as { data: { houseId: string } };
  const site = await db
    .selectFrom('game.sites')
    .select('id')
    .where('house_id', '=', data.houseId)
    .executeTakeFirstOrThrow();
  return { user, houseId: data.houseId, siteId: site.id };
}

/** Fait vieillir le cycle en cours : la garde de la base interdit l'antidatage, levée ici le temps du test. */
async function age(siteId: string, cycles: number) {
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = created_at - ${`${cycles * CYCLE_MS} milliseconds`}::interval,
      cycle_started_at = cycle_started_at - ${`${cycles * CYCLE_MS} milliseconds`}::interval where id = ${siteId}`.execute(
      trx,
    );
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}

const stockOf = async (houseId: string) =>
  (
    await db
      .selectFrom('game.inventories')
      .select(['good_id', 'quantity'])
      .where('house_id', '=', houseId)
      .execute()
  ).map((row) => [row.good_id, Number(row.quantity)]);
const collect = async (user: string, siteId: string, key?: string) => {
  const res = await send(user, 'site.collect', { siteId }, key);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('site.collect', () => {
  it('rien à récolter avant la fin du premier cycle, et rien n’est écrit', async () => {
    const player = await newPlayer();
    await age(player.siteId, 0.99);
    expect(await collect(player.user, player.siteId)).toMatchObject({
      status: 409,
      body: { error: { code: 'NOTHING_TO_COLLECT' } },
    });
    expect(await stockOf(player.houseId)).toEqual([]);
  });

  it('récolte les cycles entiers écoulés, par le journal des stocks, et garde le temps entamé', async () => {
    const player = await newPlayer();
    await age(player.siteId, 2.5);
    const first = await collect(player.user, player.siteId);
    expect(first).toMatchObject({
      status: 200,
      body: { data: { cycles: 2, outputs: [{ goodId: GOOD, quantity: 2 * PER_CYCLE }] } },
    });
    expect(await stockOf(player.houseId)).toEqual([[GOOD, 2 * PER_CYCLE]]);
    const movements = await db
      .selectFrom('game.stock_ledger as m')
      .innerJoin('game.inventories as i', 'i.id', 'm.to_inventory_id')
      .select(['m.kind', 'm.from_system', 'm.quantity'])
      .where('i.house_id', '=', player.houseId)
      .execute();
    expect(movements).toEqual([
      { kind: 'site.collect', from_system: 'production', quantity: String(2 * PER_CYCLE) },
    ]);
    // Le demi-cycle entamé n'est pas perdu : un demi-cycle de plus suffit pour le suivant.
    expect((await collect(player.user, player.siteId)).status).toBe(409);
    await age(player.siteId, 0.5);
    expect((await collect(player.user, player.siteId)).body).toMatchObject({ data: { cycles: 1 } });
    expect(await stockOf(player.houseId)).toEqual([[GOOD, 3 * PER_CYCLE]]);
    const events = await db
      .selectFrom('game.domain_events')
      .select('type')
      .where(sql<boolean>`payload->>'siteId' = ${player.siteId}`)
      .execute();
    expect(events).toEqual([{ type: 'SiteCollected' }, { type: 'SiteCollected' }]);
  });

  it('plafonne à la capacité du site', async () => {
    const player = await newPlayer();
    await age(player.siteId, recipe.maxAccruedCycles + 40);
    expect((await collect(player.user, player.siteId)).body).toMatchObject({
      data: { cycles: recipe.maxAccruedCycles },
    });
    expect(await stockOf(player.houseId)).toEqual([[GOOD, recipe.maxAccruedCycles * PER_CYCLE]]);
    expect((await collect(player.user, player.siteId)).status).toBe(409);
  });

  it('collectes simultanées : le verrou du site les met en file, la production n’est comptée qu’une fois', async () => {
    const player = await newPlayer();
    await age(player.siteId, 3);
    // Une transaction tierce tient le site : les deux collectes sont forcées d'attendre ensemble.
    const holder = await db.startTransaction().execute();
    await sql`select 1 from game.sites where id = ${player.siteId} for update`.execute(holder);
    const pending = [collect(player.user, player.siteId), collect(player.user, player.siteId)];
    const waiting = async () =>
      Number(
        (
          await sql<{ n: string }>`select count(*) as n from pg_stat_activity
            where wait_event_type = 'Lock' and query like '%game%sites%' and query not like '%pg_stat_activity%'`.execute(
            owner,
          )
        ).rows[0]?.n,
      );
    for (let tries = 0; (await waiting()) < 2; tries += 1) {
      if (tries > 200) throw new Error('the two collects never queued behind the site lock');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await holder.commit().execute();
    const statuses = (await Promise.all(pending)).map((result) => result.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await stockOf(player.houseId)).toEqual([[GOOD, 3 * PER_CYCLE]]);
  });

  it('rejeu de la même clé : même réponse, aucune seconde récolte', async () => {
    const player = await newPlayer();
    await age(player.siteId, 2);
    const key = randomUUID();
    const first = await collect(player.user, player.siteId, key);
    await age(player.siteId, 2);
    expect(await collect(player.user, player.siteId, key)).toEqual(first);
    expect(await stockOf(player.houseId)).toEqual([[GOOD, 2 * PER_CYCLE]]);
  });

  it('le site d’un autre joueur ou un site inconnu est introuvable, et rien ne bouge', async () => {
    const [owner, thief] = [await newPlayer(), await newPlayer()];
    await age(owner.siteId, 2);
    for (const siteId of [owner.siteId, randomUUID()]) {
      expect(await collect(thief.user, siteId)).toMatchObject({
        status: 404,
        body: { error: { code: 'SITE_NOT_FOUND' } },
      });
    }
    expect([await stockOf(owner.houseId), await stockOf(thief.houseId)]).toEqual([[], []]);
    expect((await collect(owner.user, owner.siteId)).body).toMatchObject({ data: { cycles: 2 } });
  });
});
