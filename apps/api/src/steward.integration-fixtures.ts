import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { expect } from 'vitest';
import { TEST_CONFIG } from './test-config';
import {
  appWithConfig,
  db,
  owner,
  send,
  type App,
  type Reply,
} from './voyage.integration-fixtures';

/**
 * Jeux d'essai des tests d'intégration des intendants (#278), contre Supabase local : une maison fondée par la
 * commande, avec son champ de blé de départ et un moulin acheté, dont l'intrant est le blé.
 */
export { appWithConfig, balanceOf, db, owner, send } from './voyage.integration-fixtures';
const stewards = TEST_CONFIG.config.stewards;
if (!stewards) throw new Error('the test configuration has no stewards');
export const STEWARDS = stewards;
/** Une seule embauche par maison, et deux règles par intendant. */
export const narrow = appWithConfig((config) => ({
  ...config,
  stewards: { ...stewards, limitByHeadquartersLevel: [1], rulesPerSteward: 2 },
}));
export const code = (reply: Reply) => reply.body.error?.code ?? 'ok';

export async function newPlayer() {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const name = `Intendance ${[...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
  const blazon = { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' };
  const cityId = '01900000-0000-7000-8000-000000000101';
  const founded = await send(user, 'house.create', { cityId, name, blazon });
  expect(founded.status).toBe(200);
  const houseId = founded.body.data.houseId as string;
  const mill = await send(user, 'site.acquire', { recipeId: 'mill_flour' });
  expect(mill.status).toBe(200);
  const field = await db
    .selectFrom('game.sites')
    .select('id')
    .where('house_id', '=', houseId)
    .where('recipe_id', '=', 'grow_wheat')
    .executeTakeFirstOrThrow();
  return { user, houseId, field: field.id, mill: mill.body.data.siteId as string };
}

export const stewardsOf = (houseId: string) =>
  db
    .selectFrom('game.stewards')
    .select(['id', 'site_id', 'name', 'hired_at', 'unpaid_since', 'dismissed_at', 'rules_revision'])
    .where('house_id', '=', houseId)
    .orderBy('hired_at')
    .execute();

/** Événements des intendants de la maison, dans leur ordre. */
export const eventsOf = async (houseId: string) =>
  (
    await db
      .selectFrom('game.domain_events')
      .select(['type', 'payload'])
      .where(sql<boolean>`payload->>'houseId' = ${houseId}`)
      .where('type', 'like', 'Steward%')
      .orderBy('seq')
      .execute()
  ).map(({ type, payload }) => ({ type, payload: payload as Record<string, unknown> }));

/** Embauche l'intendant du site et rend son identifiant. */
export const hire = async (user: string, siteId: string, via?: App) =>
  (await send(user, 'steward.hire', { siteId }, randomUUID(), via)).body.data.stewardId as string;
