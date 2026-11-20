import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll } from 'vitest';
import type { CloseStep } from '../close';

/**
 * Jeux d'essai des tests d'intégration de l'ostracisme à la clôture (6.4, #722), contre Supabase local : chaque test
 * a son monde. La configuration ouvre le modèle ; `decrees` est celle qui le laisse fermé.
 */
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const db = createDb(serviceRoleUrl(DATABASE_URL));
export const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
export const clock = {
  tickMinutes: 10,
  dailyCloseHour: 4,
  timezone: 'Europe/Paris',
  seasonDays: 7,
};
const RULES = { votingDays: 3, quorumBps: 3000, ostracismDays: 7, intervalDays: 28 };
export const decrees = initial.decrees ?? {
  votingDays: 2,
  quorumBps: 0,
  maxOpenPerCity: 3,
  spendingCapShareBps: 0,
  models: {},
};
export const opened = {
  ...initial,
  clock,
  decrees: { ...decrees, models: { ...decrees.models, ostracism: RULES } },
};
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
export const config = { at: async () => ({ ...loaded, config: opened }) };
export const TODAY = gameDayAt(new Date(), clock);
export const at = (day: number) => dailyCloseAt(day, clock);
const GUARDED = [
  'citizenships',
  'elections',
  'offices',
  'candidacies',
  'ballots',
  'decrees',
  'ostracisms',
  'ostraca',
];

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Un monde, une cité, des maisons citoyennes depuis dix jours, dont la première est archonte en charge ; un
 * décret d'ostracisme adopté et, si demandé, son vote clos à `closesAt`, avec ses bulletins (votant, nommé).
 * Tout est posé garde levée.
 */
export async function newWorld(
  citizens: number,
  vote?: { closesAt: Date; quorumBps: number; ostraca: [number, number][] },
) {
  const [worldId, cityId, officeId, decreeId, ostracismId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const houseIds = Array.from({ length: citizens }, () => randomUUID());
  await owner.transaction().execute(async (trx) => {
    for (const name of GUARDED)
      await sql`alter table ${sql.table(`game.${name}`)} disable trigger ${sql.ref(`${name}_guard`)}`.execute(
        trx,
      );
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`o-${worldId.slice(0, 12)}`}, 'Test')`.execute(
      trx,
    );
    await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'K')`.execute(
      trx,
    );
    for (const houseId of houseIds) {
      const userId = randomUUID();
      await sql`with player as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`}))
        insert into game.houses (id, world_id, user_id, name, blazon)
        values (${houseId}, ${worldId}, ${userId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}')`.execute(
        trx,
      );
      await sql`insert into game.citizenships (house_id, city_id, status, since)
        values (${houseId}, ${cityId}, 'citizen', now() - interval '10 days')`.execute(trx);
    }
    await sql`with e as (insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
        values (${worldId}, ${cityId}, 'archon', now() - interval '9 days', now() - interval '8 days', now() - interval '7 days', now() + interval '20 days', now())
        returning *)
      insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
      select ${officeId}, world_id, city_id, office, ${houseIds[0]}, id, voting_closes_at, term_ends_at from e`.execute(
      trx,
    );
    await sql`insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at, voting_closes_at,
        quorum_bps, status, tallied_at, electorate, votes_for, votes_against)
      values (${decreeId}, ${worldId}, ${cityId}, 'ostracism', '{}', ${officeId}, ${houseIds[0]}, now() - interval '6 days',
        now() - interval '4 days', 0, 'adopted', now() - interval '4 days', ${citizens}, ${citizens}, 0)`.execute(
      trx,
    );
    if (vote) {
      await sql`insert into game.ostracisms (id, world_id, city_id, decree_id, opened_at, voting_closes_at, quorum_bps, ostracism_days)
        values (${ostracismId}, ${worldId}, ${cityId}, ${decreeId}, least(now() - interval '3 days', ${vote.closesAt}::timestamptz - interval '1 day'), ${vote.closesAt}, ${vote.quorumBps}, 7)`.execute(
        trx,
      );
      for (const [voter, target] of vote.ostraca)
        await sql`insert into game.ostraca (ostracism_id, house_id, target_house_id, cast_at)
          values (${ostracismId}, ${houseIds[voter]}, ${houseIds[target]}, now() - interval '2 days')`.execute(
          trx,
        );
    }
    for (const name of GUARDED)
      await sql`alter table ${sql.table(`game.${name}`)} enable trigger ${sql.ref(`${name}_guard`)}`.execute(
        trx,
      );
  });
  return { worldId, cityId, officeId, decreeId, ostracismId, houseIds };
}
export const step = (world: { worldId: string }, run: CloseStep, config: GameConfig = opened) =>
  db
    .transaction()
    .execute((trx) =>
      run.run({ trx, worldId: world.worldId, gameDay: TODAY, closeAt: at(TODAY), config }),
    );
export const ostracism = async (id: string) =>
  (
    await sql<{ outcome: string | null; house: string | null; ends_at: Date | null }>`
      select concat_ws(':', outcome, ballots, electorate) as outcome, ostracized_house_id as house, ends_at
      from game.ostracisms where id = ${id}`.execute(db)
  ).rows[0];
export const eventsOf = async (ostracismId: string) =>
  (
    await sql<{
      type: string;
      payload: Record<string, unknown>;
    }>`select type, payload from game.domain_events
      where payload->>'ostracismId' = ${ostracismId} order by seq`.execute(db)
  ).rows;
