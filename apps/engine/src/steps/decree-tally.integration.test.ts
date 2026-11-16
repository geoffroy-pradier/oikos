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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorld } from '../scheduler';
import { decreeTally } from './decree-tally';

// Dépouillement des décrets à la clôture, contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const config = { at: async () => ({ ...loaded, config: { ...initial, clock } }) };
const TODAY = gameDayAt(new Date(), clock);
const at = (day: number) => dailyCloseAt(day, clock);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Un monde, une cité, des maisons citoyennes depuis dix jours (antidatées garde levée), dont la première est
 * archonte en charge, et `late` maisons devenues citoyennes à l'instant, après la fin de tout vote échu.
 */
async function newWorld(citizens: number, late = 0) {
  const [worldId, cityId, officeId] = [randomUUID(), randomUUID(), randomUUID()];
  const houseIds = Array.from({ length: citizens + late }, () => randomUUID());
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`t-${worldId.slice(0, 12)}`}, 'Test')`.execute(
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
      await sql`insert into game.citizenships (house_id, city_id) values (${houseId}, ${cityId})`.execute(
        trx,
      );
    }
    await sql`update game.citizenships set status = 'citizen', since = now() where house_id = any(${houseIds}::uuid[])`.execute(
      trx,
    );
    for (const name of ['citizenships', 'elections', 'offices'])
      await sql`alter table ${sql.table(`game.${name}`)} disable trigger ${sql.ref(`${name}_guard`)}`.execute(
        trx,
      );
    await sql`update game.citizenships set since = now() - interval '10 days' where house_id = any(${houseIds.slice(0, citizens)}::uuid[])`.execute(
      trx,
    );
    await sql`with e as (insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
        values (${worldId}, ${cityId}, 'archon', now() - interval '9 days', now() - interval '8 days', now() - interval '7 days', now() + interval '20 days', now())
        returning *)
      insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
      select ${officeId}, world_id, city_id, office, ${houseIds[0]}, id, voting_closes_at, term_ends_at from e`.execute(
      trx,
    );
    for (const name of ['citizenships', 'elections', 'offices'])
      await sql`alter table ${sql.table(`game.${name}`)} enable trigger ${sql.ref(`${name}_guard`)}`.execute(
        trx,
      );
  });
  /** Un décret proposé il y a trois jours, dont le vote finit à `closesAt`, et ses votes (antidatés). */
  const decree = async (
    closesAt: Date,
    quorumBps: number,
    votes: [house: number, approve: boolean][] = [],
  ) => {
    const decreeId = randomUUID();
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.decrees disable trigger decrees_guard`.execute(trx);
      await sql`alter table game.decree_votes disable trigger decree_votes_guard`.execute(trx);
      await sql`insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at, voting_closes_at, quorum_bps)
        values (${decreeId}, ${worldId}, ${cityId}, 'public_works', '{"amountOboles": 600}', ${officeId}, ${houseIds[0]},
          now() - interval '3 days', ${closesAt}, ${quorumBps})`.execute(trx);
      for (const [house, approve] of votes)
        await sql`insert into game.decree_votes (decree_id, house_id, approve, cast_at)
          values (${decreeId}, ${houseIds[house]}, ${approve}, now() - interval '2 days')`.execute(
          trx,
        );
      await sql`alter table game.decrees enable trigger decrees_guard`.execute(trx);
      await sql`alter table game.decree_votes enable trigger decree_votes_guard`.execute(trx);
    });
    return decreeId;
  };
  const tally = (trx: typeof db, closeAt = at(TODAY)) =>
    decreeTally.run({ trx, worldId, gameDay: TODAY, closeAt, config: { ...initial, clock } });
  return { worldId, cityId, houseIds, decree, tally };
}
const outcome = async (decreeId: string) =>
  (
    await sql<{
      outcome: string;
    }>`select concat_ws(':', status, votes_for, votes_against, electorate) as outcome
      from game.decrees where id = ${decreeId}`.execute(db)
  ).rows[0]?.outcome;
const eventsOf = async (decreeId: string) =>
  (
    await sql<{
      type: string;
      payload: Record<string, unknown>;
    }>`select type, payload from game.domain_events
      where payload->>'decreeId' = ${decreeId} order by seq`.execute(db)
  ).rows;

describe('dépouillement des décrets à la clôture', () => {
  it('quorum en part des citoyens à la fin du vote, majorité stricte ; une seule fois même rejouée', async () => {
    // Quatre citoyens comptés, et deux promus après la fin du vote, qui ne le sont pas.
    const world = await newWorld(4, 2);
    const closes = at(TODAY);
    const adopted = await world.decree(closes, 5000, [
      [0, true],
      [1, true],
      [2, false],
    ]);
    const missed = await world.decree(closes, 5000, [[0, true]]); // 1 sur 4 : 25 % < 50 %
    const tie = await world.decree(closes, 0, [
      [0, true],
      [1, false],
    ]);
    const silent = await world.decree(closes, 0);
    const pending = await world.decree(at(TODAY + 1), 0, [[0, true]]);
    const runs = await Promise.all(
      [1, 2, 3].map(() =>
        closeWorld(db, { worldId: world.worldId, now: closes, config, steps: [decreeTally] }),
      ),
    );
    expect(runs.flat()).toEqual([TODAY]);
    expect(await Promise.all([adopted, missed, tie, silent, pending].map(outcome))).toEqual([
      'adopted:2:1:4',
      'rejected:1:0:4',
      'rejected:1:1:4',
      'rejected:0:0:4',
      'proposed',
    ]);
    expect(await eventsOf(adopted)).toEqual([
      {
        type: 'DecreeAdopted',
        payload: {
          decreeId: adopted,
          cityId: world.cityId,
          model: 'public_works',
          votesFor: 2,
          votesAgainst: 1,
          electorate: 4,
          quorumReached: true,
        },
      },
    ]);
    expect(
      (await eventsOf(missed)).map((event) => [event.type, event.payload['quorumReached']]),
    ).toEqual([['DecreeRejected', false]]);
    // L'étape rejouée seule ne retrouve aucun décret : ils sont dépouillés, et la base refuserait un second
    // dépouillement.
    expect(await db.transaction().execute((trx) => world.tally(trx))).toEqual({
      tallied: 0,
      adopted: 0,
      rejected: 0,
    });
    expect((await eventsOf(adopted)).length).toBe(1);
  });
});

describe('dépouillement et votes concurrents', () => {
  /** Un décret dont le vote finit dans une seconde et demie, quorum nul. */
  async function closingSoon() {
    const world = await newWorld(2);
    const decreeId = await world.decree(new Date(Date.now() + 1_500), 0);
    const vote = (trx: typeof db, house: number) =>
      sql`insert into game.decree_votes (decree_id, house_id, approve) values (${decreeId}, ${world.houseIds[house]}, true)`.execute(
        trx,
      );
    return { ...world, decreeId, vote };
  }
  const settled = <T>(promise: Promise<T>) => {
    const state = { settled: false };
    void promise.finally(() => (state.settled = true)).catch(() => undefined);
    return state;
  };

  it('un vote déposé avant la fin du vote et validé pendant le dépouillement est attendu et compté', async () => {
    const world = await closingSoon();
    const ballot = await db.startTransaction().execute();
    await world.vote(ballot, 1);
    await sleep(1_600);
    const tally = db.transaction().execute((trx) => world.tally(trx, new Date()));
    const state = settled(tally);
    await sleep(300);
    expect(state.settled).toBe(false);
    await ballot.commit().execute();
    expect(await tally).toEqual({ tallied: 1, adopted: 1, rejected: 0 });
    expect(await outcome(world.decreeId)).toBe('adopted:1:0:2');
  });

  it('deux dépouillements hors du verrou de la clôture : le second attend et saute le décret', async () => {
    const world = await closingSoon();
    await sleep(1_600);
    const first = await db.startTransaction().execute();
    expect(await world.tally(first, new Date())).toEqual({ tallied: 1, adopted: 0, rejected: 1 });
    const second = db.transaction().execute((trx) => world.tally(trx, new Date()));
    const state = settled(second);
    await sleep(300);
    expect(state.settled).toBe(false);
    await first.commit().execute();
    expect(await second).toEqual({ tallied: 0, adopted: 0, rejected: 0 });
    expect(await outcome(world.decreeId)).toBe('rejected:0:0:2');
  });

  it('un vote commencé avant la fin du vote mais qui attend le dépouillement est refusé', async () => {
    const world = await closingSoon();
    const ballot = await db.startTransaction().execute();
    await sql`select now()`.execute(ballot);
    await sleep(1_600);
    const tally = await db.startTransaction().execute();
    expect(await world.tally(tally, new Date())).toEqual({ tallied: 1, adopted: 0, rejected: 1 });
    const late = world.vote(ballot, 1);
    const state = settled(late);
    await sleep(300);
    expect(state.settled).toBe(false);
    await tally.commit().execute();
    await expect(late).rejects.toMatchObject({ constraint: 'decree_votes_voting_period' });
    await ballot.rollback().execute();
    expect(await outcome(world.decreeId)).toBe('rejected:0:0:2');
  });
});
