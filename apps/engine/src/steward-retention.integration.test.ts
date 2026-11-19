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
import { purgeStewardOperations } from './steward-retention';
import { runStewards } from './stewards';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// La purge et les intendants agissent sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const loader = createConfigLoader(db);

beforeAll(() => ensureInitialConfig(db, INITIAL_CONFIG));
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Configuration réduite à la conservation des opérations : la purge n'en lit rien d'autre. */
const retention = (operationsRetentionDays: number) =>
  ({
    at: async () => ({ config: { stewards: { operationsRetentionDays } } }),
  }) as unknown as Pick<ConfigLoader, 'at'>;

/**
 * Un monde neuf, joué jusqu'au tick `lastTick`, où une maison a un champ de blé dont deux cycles sont récoltables, et
 * son intendant payé qui récolte. Ses opérations passées sont posées antidatées (garde levée le temps de les écrire) :
 * tick, rang et âge en jours. Rend le tick du moteur et une fonction qui relit les opérations (tick/rang).
 */
async function stewardWith(lastTick: number, operations: [number, number, number][]) {
  const [worldId, cityId, houseId, userId, siteId, stewardId] = Array.from(
    { length: 6 },
    randomUUID,
  ) as [string, string, string, string, string, string];
  const active = await loader.at(new Date());
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`o-${worldId.slice(0, 12)}`}, 'Test')`.execute(
      trx,
    );
    await sql`insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch)
      values (${worldId}, ${lastTick}, now(), 'graine-de-test-0561', ${active.id}, false, false)`.execute(
      trx,
    );
    await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'K')`.execute(
      trx,
    );
    await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`.execute(
      trx,
    );
    await sql`insert into game.houses (id, world_id, user_id, name, blazon) values (${houseId}, ${worldId}, ${userId}, 'Intendance', '{}')`.execute(
      trx,
    );
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`insert into game.sites (id, world_id, house_id, city_id, recipe_id, created_at, cycle_started_at)
      values (${siteId}, ${worldId}, ${houseId}, ${cityId}, 'grow_wheat', now() - interval '2 days', now() - interval '2 days')`.execute(
      trx,
    );
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    await sql`insert into game.stewards (id, world_id, house_id, site_id, name)
      values (${stewardId}, ${worldId}, ${houseId}, ${siteId}, 'Nikias')`.execute(trx);
    await sql`update game.stewards set rules_revision = 1, unpaid_since = null where id = ${stewardId}`.execute(
      trx,
    );
    await sql`insert into game.steward_rules (steward_id, revision, position, kind)
      values (${stewardId}, 1, 0, 'collect')`.execute(trx);
    await sql`alter table game.steward_operations disable trigger steward_operations_guard`.execute(
      trx,
    );
    for (const [tick, rank, age] of operations)
      await sql`insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision,
        rule_position, status, summary, command_id, created_at)
        values (${worldId}, ${stewardId}, ${tick}, ${rank}, 1, 0, 'ok', '{"command": "site.collect"}', ${randomUUID()},
          now() - make_interval(days => ${age}))`.execute(trx);
    await sql`alter table game.steward_operations enable trigger steward_operations_guard`.execute(
      trx,
    );
  });
  const stewards = active.config.stewards;
  if (!stewards) throw new Error('the active configuration has no stewards');
  // Deux opérations par tick : le rang 0 d'un tick n'est alors pas la dernière opération de l'intendant.
  const tick = (index: number) => ({
    worldId,
    index,
    configVersionId: active.id,
    config: { ...active.config, stewards: { ...stewards, operationsPerTick: 2 } },
  });
  const remaining = async () =>
    (
      await db
        .selectFrom('game.steward_operations')
        .select(['tick_index', 'rank'])
        .where('steward_id', '=', stewardId)
        .orderBy('tick_index')
        .orderBy('rank')
        .execute()
    ).map((op) => `${op.tick_index}/${op.rank}`);
  return { tick, remaining };
}

describe('conservation des opérations d’intendant', () => {
  it('supprime les opérations échues sauf celles du dernier tick ; rejouer ce tick ne double rien, la file continue', async () => {
    const { tick, remaining } = await stewardWith(50, [
      [40, 0, 40],
      [40, 1, 40],
      [50, 0, 40],
      [50, 1, 40],
    ]);
    expect(
      await purgeStewardOperations(db, { now: new Date(), config: retention(30) }),
    ).toBeGreaterThanOrEqual(2);
    expect(await remaining()).toEqual(['50/0', '50/1']);
    // Le dernier tick est déjà mené, rang par rang : le moteur qui le relit ne récolte pas une seconde fois.
    expect(await runStewards(db, tick(50))).toEqual({ acted: 0, refused: 0, failed: 0 });
    expect(await remaining()).toEqual(['50/0', '50/1']);
    // Le tick suivant récolte les deux cycles, pendant une purge, sans attendre l'un l'autre ; le second rang n'a plus
    // rien à faire.
    const [run] = await Promise.all([
      runStewards(db, tick(51)),
      purgeStewardOperations(db, { now: new Date(), config: retention(1) }),
    ]);
    expect(run).toEqual({ acted: 1, refused: 0, failed: 0 });
    expect(await remaining()).toEqual(['50/0', '50/1', '51/0']);
  });

  it('garde la dernière opération d’un intendant, même échue, et lit la conservation en vigueur : 30 jours', async () => {
    const { remaining } = await stewardWith(100, [
      [10, 0, 45],
      [11, 0, 31],
      [12, 0, 29],
      [20, 0, 40],
    ]);
    // La dernière (tick 20) est échue mais reste : la file des règles en repart.
    await purgeStewardOperations(db, { now: new Date(), config: createConfigLoader(db) });
    expect(await remaining()).toEqual(['12/0', '20/0']);
    // Plus courte, la conservation ne prend que les opérations de plus d'un jour, la dernière exceptée.
    await purgeStewardOperations(db, { now: new Date(), config: retention(1) });
    expect(await remaining()).toEqual(['20/0']);
  });

  it('le service ne supprime aucune opération en direct', async () => {
    await expect(sql`delete from game.steward_operations`.execute(db)).rejects.toMatchObject({
      code: '42501',
    });
  });
});
