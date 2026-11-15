import { randomUUID } from 'node:crypto';
import {
  type ConfigLoader,
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeMessages } from './chat-retention';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// La purge agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);

beforeAll(() => ensureInitialConfig(db, INITIAL_CONFIG));
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Configuration réduite à la conservation : la purge n'en lit rien d'autre. */
const retention = (retentionDays: number) =>
  ({
    at: async () => ({ config: { chat: { retentionDays } } }),
  }) as unknown as Pick<ConfigLoader, 'at'>;

/**
 * Une maison d'un monde neuf, qui a écrit dans le canal de sa cité il y a chacun des âges donnés, en jours
 * (garde levée le temps de les antidater). Rend une fonction qui relit les âges des messages restants.
 */
async function messagesAged(ages: number[]) {
  const [worldId, cityId, houseId, userId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`m-${worldId.slice(0, 12)}`}, 'Test')`.execute(
      trx,
    );
    await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'K')`.execute(
      trx,
    );
    await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`.execute(
      trx,
    );
    await sql`insert into game.houses (id, world_id, user_id, name, blazon) values (${houseId}, ${worldId}, ${userId}, 'Logographes', '{}')`.execute(
      trx,
    );
    await sql`insert into game.citizenships (house_id, city_id) values (${houseId}, ${cityId})`.execute(
      trx,
    );
    await sql`alter table game.messages disable trigger messages_guard`.execute(trx);
    await sql`insert into game.messages (channel_id, house_id, body, created_at)
      select c.id, ${houseId}, 'Ancien', now() - make_interval(days => age)
      from game.channels c, unnest(${ages}::int[]) age where c.city_id = ${cityId}`.execute(trx);
    await sql`alter table game.messages enable trigger messages_guard`.execute(trx);
  });
  return async () =>
    (
      await sql<{ age: number }>`select extract(day from now() - created_at)::int as age
        from game.messages where house_id = ${houseId} order by created_at`.execute(owner)
    ).rows.map((row) => row.age);
}

describe('conservation des messages', () => {
  it('supprime, sous le rôle de service, les messages plus anciens que la conservation, et eux seuls', async () => {
    const remaining = await messagesAged([45, 31, 29, 1, 0]);
    expect(
      await purgeMessages(db, { now: new Date(), config: retention(30) }),
    ).toBeGreaterThanOrEqual(2);
    expect(await remaining()).toEqual([29, 1, 0]);
    expect(
      await purgeMessages(db, { now: new Date(), config: retention(2) }),
    ).toBeGreaterThanOrEqual(1);
    expect(await remaining()).toEqual([1, 0]);
  });

  it('lit la conservation de la configuration en vigueur : 30 jours', async () => {
    const remaining = await messagesAged([31, 29]);
    await purgeMessages(db, { now: new Date(), config: createConfigLoader(db) });
    expect(await remaining()).toEqual([29]);
  });

  it('le service ne supprime aucun message en direct', async () => {
    await expect(sql`delete from game.messages`.execute(db)).rejects.toMatchObject({
      code: '42501',
    });
  });
});
