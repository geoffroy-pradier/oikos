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
import { archonOpening } from './archon-opening';
import { archonTally } from './archon-tally';

// Élection de l'archonte à la clôture, contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
const archon = { termDays: 28, candidacyDays: 4, votingDays: 3, maxConsecutiveTerms: 2 };
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const politics = { ...initial, clock, politics: { meticDays: 3, archon } };
const config = { at: async () => ({ ...loaded, config: politics }) };
/** Jour de jeu en cours : sa clôture est passée. */
const TODAY = gameDayAt(new Date(), clock);
const at = (day: number) => dailyCloseAt(day, clock);
const close = (worldId: string) =>
  closeWorld(db, { worldId, now: at(TODAY), config, steps: [archonTally, archonOpening] });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Un monde, ses cités et, dans la première, des maisons citoyennes (posés par le propriétaire). */
async function newWorld(cities = 1, citizens = 0) {
  const worldId = randomUUID();
  const cityIds = Array.from({ length: cities }, () => randomUUID()).sort();
  const houseIds = Array.from({ length: citizens }, () => randomUUID());
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`a-${worldId.slice(0, 12)}`}, 'Test')`.execute(
      trx,
    );
    for (const [rank, cityId] of cityIds.entries())
      await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, ${`cite-${rank}`}, 'Cité')`.execute(
        trx,
      );
    for (const houseId of houseIds) {
      const userId = randomUUID();
      await sql`with player as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`}))
        insert into game.houses (id, world_id, user_id, name, blazon)
        values (${houseId}, ${worldId}, ${userId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}')`.execute(
        trx,
      );
      await sql`insert into game.citizenships (house_id, city_id) values (${houseId}, ${cityIds[0]})`.execute(
        trx,
      );
    }
    await sql`update game.citizenships set status = 'citizen', since = now() where house_id = any(${houseIds}::uuid[])`.execute(
      trx,
    );
  });
  return { worldId, cityIds, houseIds };
}
type Calendar = [candidacy: number, voting: number, closes: number, termEnds: number];
/**
 * Une élection de la cité à ce calendrier (jours de jeu), ses candidatures (maison et jours depuis le
 * dépôt, retrait éventuel) et ses bulletins (maison, rang de la candidature), antidatés garde levée.
 */
async function seed(
  cityId: string,
  [candidacy, voting, closes, termEnds]: Calendar,
  candidacies: { houseId: string; filed: number; withdrawn?: boolean }[] = [],
  ballots: [voter: string, candidacy: number][] = [],
  tallied = false,
) {
  const electionId = randomUUID();
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
      select ${electionId}, world_id, id, 'archon', ${at(candidacy)}, ${at(voting)}, ${at(closes)}, ${at(termEnds)}
      from game.cities where id = ${cityId}`.execute(trx);
    if (tallied)
      await sql`update game.elections set tallied_at = now() where id = ${electionId}`.execute(trx);
    await sql`alter table game.candidacies disable trigger candidacies_guard`.execute(trx);
    await sql`alter table game.ballots disable trigger ballots_guard`.execute(trx);
    const ids: string[] = [];
    for (const { houseId, filed, withdrawn } of candidacies) {
      ids.push(randomUUID());
      await sql`insert into game.candidacies (id, election_id, house_id, created_at, withdrawn_at)
        values (${ids.at(-1)}, ${electionId}, ${houseId}, ${at(TODAY - filed)}, ${withdrawn ? at(TODAY - 1) : null})`.execute(
        trx,
      );
    }
    for (const [voter, rank] of ballots)
      await sql`insert into game.ballots (election_id, house_id, candidacy_id, cast_at)
        values (${electionId}, ${voter}, ${ids[rank]}, ${at(TODAY - 1)})`.execute(trx);
    await sql`alter table game.candidacies enable trigger candidacies_guard`.execute(trx);
    await sql`alter table game.ballots enable trigger ballots_guard`.execute(trx);
  });
  return electionId;
}
const one = async <T>(query: ReturnType<typeof sql<T>>) => (await query.execute(db)).rows;
/** Calendrier des élections de la cité (instants en millisecondes) et dépouillement. */
const electionsOf = (cityId: string) =>
  one(sql<{
    calendar: number[];
    tallied: boolean;
  }>`select array[candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at]
      ::timestamptz[] as calendar, tallied_at is not null as tallied
    from game.elections where city_id = ${cityId} order by voting_closes_at`).then((rows) =>
    rows.map((row) => ({
      ...row,
      calendar: row.calendar.map((instant) => new Date(instant).getTime()),
    })),
  );
const calendar = (...days: number[]) => days.map((day) => at(day).getTime());
const officesOf = (cityId: string) =>
  one(sql<{
    house_id: string;
    starts: boolean;
    ends: boolean;
  }>`select o.house_id, o.starts_at = e.voting_closes_at as starts, o.ends_at = e.term_ends_at as ends
    from game.offices o join game.elections e on e.id = o.election_id where o.city_id = ${cityId}`);
const electedEvents = (cityId: string) =>
  one(sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
    where type = 'ArchonElected' and payload->>'cityId' = ${cityId} order by seq`).then((rows) =>
    rows.map((row) => row.payload),
  );
const summaryOf = async (worldId: string) =>
  (
    await one(
      sql<{
        summary: Record<string, unknown>;
      }>`select summary from game.daily_closes where world_id = ${worldId}`,
    )
  )[0]?.summary;

describe('élection de l’archonte à la clôture quotidienne', () => {
  it('monde neuf : chaque cité ouvre une élection, dépôt maintenant, vote 4 jours plus tard, mandat de 28 jours', async () => {
    const world = await newWorld(2);
    // Trois moteurs à la fois : une seule clôture, une seule élection par cité.
    expect((await Promise.all([1, 2, 3].map(() => close(world.worldId)))).flat()).toEqual([TODAY]);
    const expected = {
      calendar: calendar(TODAY, TODAY + 4, TODAY + 7, TODAY + 35),
      tallied: false,
    };
    for (const cityId of world.cityIds) expect(await electionsOf(cityId)).toEqual([expected]);
    expect(await summaryOf(world.worldId)).toEqual({
      archonTally: { tallied: 0, elected: 0, vacant: 0 },
      archonOpening: { opened: 2 },
    });
  });

  it('dépouillement : la candidature qui a le plus de bulletins est élue pour le mandat de son élection', async () => {
    const world = await newWorld(1, 4);
    const [a, b, c, d] = world.houseIds as [string, string, string, string];
    const [cityId] = world.cityIds as [string];
    const electionId = await seed(
      cityId,
      [TODAY - 7, TODAY - 3, TODAY, TODAY + 28],
      [
        { houseId: a, filed: 6 },
        { houseId: b, filed: 5 },
      ],
      [
        [a, 0],
        [c, 1],
        [d, 1],
      ],
    );
    expect(await close(world.worldId)).toEqual([TODAY]);
    expect(await officesOf(cityId)).toEqual([{ house_id: b, starts: true, ends: true }]);
    expect(await electedEvents(cityId)).toEqual([
      {
        electionId,
        cityId,
        houseId: b,
        votes: 2,
        termStartsAt: at(TODAY).toISOString(),
        termEndsAt: at(TODAY + 28).toISOString(),
      },
    ]);
    // Le mandat suivant commence dans 28 jours : son élection ne s'ouvre pas encore.
    expect(await summaryOf(world.worldId)).toEqual({
      archonTally: { tallied: 1, elected: 1, vacant: 0 },
      archonOpening: { opened: 0 },
    });
    expect((await electionsOf(cityId)).map((row) => row.tallied)).toEqual([true]);
    // Rejouées hors du registre des clôtures (même jour), les étapes ne dépouillent ni n'ouvrent rien de plus.
    const context = {
      worldId: world.worldId,
      gameDay: TODAY,
      closeAt: at(TODAY),
      config: politics,
    };
    const again = await db
      .transaction()
      .execute(async (trx) => [
        await archonTally.run({ ...context, trx }),
        await archonOpening.run({ ...context, trx }),
      ]);
    expect(again).toEqual([{ tallied: 0, elected: 0, vacant: 0 }, { opened: 0 }]);
    expect(await officesOf(cityId)).toHaveLength(1);
  });

  it('égalité : la candidature maintenue la plus ancienne l’emporte, une candidature retirée ne compte pas', async () => {
    const world = await newWorld(1, 3);
    const [a, b, c] = world.houseIds as [string, string, string];
    const [cityId] = world.cityIds as [string];
    await seed(
      cityId,
      [TODAY - 7, TODAY - 3, TODAY, TODAY + 28],
      [
        { houseId: c, filed: 7, withdrawn: true },
        { houseId: b, filed: 6 },
        { houseId: a, filed: 5 },
      ],
      [
        [a, 1],
        [b, 2],
      ],
    );
    await close(world.worldId);
    expect((await officesOf(cityId)).map((office) => office.house_id)).toEqual([b]);
  });

  it('sans candidat, la charge reste vacante jusqu’à l’élection suivante', async () => {
    const world = await newWorld(1);
    const [cityId] = world.cityIds as [string];
    await seed(cityId, [TODAY - 7, TODAY - 3, TODAY, TODAY + 28]);
    await close(world.worldId);
    expect(await officesOf(cityId)).toEqual([]);
    expect(await electedEvents(cityId)).toEqual([]);
    expect(await summaryOf(world.worldId)).toEqual({
      archonTally: { tallied: 1, elected: 0, vacant: 1 },
      archonOpening: { opened: 0 },
    });
  });

  it('l’élection suivante s’ouvre à son calendrier, à la fin du mandat en cours, ou plus tard si son vote a été manqué', async () => {
    const world = await newWorld(4);
    const [onTime, early, late, missed] = world.cityIds as [string, string, string, string];
    // Mandats en cours finissant dans 7, 8, 5 et 2 jours ; le dépôt dure 4 jours et le vote 3.
    for (const [cityId, end] of [
      [onTime, 7],
      [early, 8],
      [late, 5],
      [missed, 2],
    ] as const)
      await seed(cityId, [TODAY - 30, TODAY - 29, TODAY - 28 + end, TODAY + end], [], [], true);
    expect(await summaryOf(world.worldId)).toBeUndefined();
    await close(world.worldId);
    const opened = async (cityId: string) => (await electionsOf(cityId)).slice(1);
    expect(await opened(onTime)).toEqual([
      { calendar: calendar(TODAY, TODAY + 4, TODAY + 7, TODAY + 35), tallied: false },
    ]);
    expect(await opened(early)).toEqual([]);
    // Ouverture manquée (moteur arrêté) : le dépôt est écourté, le vote et le mandat restent à leur date.
    expect(await opened(late)).toEqual([
      { calendar: calendar(TODAY, TODAY + 2, TODAY + 5, TODAY + 33), tallied: false },
    ]);
    // Vote manqué : l'élection s'ouvre maintenant, au calendrier complet, et la charge est vacante d'ici là.
    expect(await opened(missed)).toEqual([
      { calendar: calendar(TODAY, TODAY + 4, TODAY + 7, TODAY + 35), tallied: false },
    ]);
  });
});

describe('dépouillement et bulletins concurrents', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Une élection dont le vote finit dans une seconde et demie, et la candidature de la première maison. */
  async function closingSoon() {
    const world = await newWorld(1, 2);
    const [a] = world.houseIds as [string, string];
    const electionId = randomUUID();
    const candidacyId = randomUUID();
    await owner.transaction().execute(async (trx) => {
      await sql`insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
        values (${electionId}, ${world.worldId}, ${world.cityIds[0]}, 'archon', now() - interval '2 days', now() - interval '1 hour',
          now() + interval '1.5 seconds', now() + interval '28 days')`.execute(trx);
      await sql`alter table game.candidacies disable trigger candidacies_guard`.execute(trx);
      await sql`insert into game.candidacies (id, election_id, house_id, created_at)
        values (${candidacyId}, ${electionId}, ${a}, now() - interval '1 day')`.execute(trx);
      await sql`alter table game.candidacies enable trigger candidacies_guard`.execute(trx);
    });
    const vote = (trx: typeof db, voter: string) =>
      sql`insert into game.ballots (election_id, house_id, candidacy_id) values (${electionId}, ${voter}, ${candidacyId})`.execute(
        trx,
      );
    const tally = (trx: typeof db) =>
      archonTally.run({
        trx,
        worldId: world.worldId,
        gameDay: TODAY,
        closeAt: new Date(),
        config: politics,
      });
    return { ...world, vote, tally };
  }
  const pending = <T>(promise: Promise<T>) => {
    const state = { settled: false };
    void promise.then(
      () => (state.settled = true),
      () => (state.settled = true),
    );
    return state;
  };

  it('un bulletin déposé avant la fin du vote et validé pendant le dépouillement est attendu et compté', async () => {
    const world = await closingSoon();
    const [a, b] = world.houseIds as [string, string];
    const ballot = await db.startTransaction().execute();
    await world.vote(ballot, b);
    await sleep(1_600);
    const tally = db.transaction().execute((trx) => world.tally(trx));
    const state = pending(tally);
    await sleep(300);
    expect(state.settled).toBe(false);
    await ballot.commit().execute();
    expect(await tally).toEqual({ tallied: 1, elected: 1, vacant: 0 });
    expect(
      (await electedEvents(world.cityIds[0] ?? '')).map((event) => [
        event['houseId'],
        event['votes'],
      ]),
    ).toEqual([[a, 1]]);
  });

  it('un bulletin commencé avant la fin du vote mais qui attend le dépouillement est refusé', async () => {
    const world = await closingSoon();
    const [, b] = world.houseIds as [string, string];
    const ballot = await db.startTransaction().execute();
    await sql`select now()`.execute(ballot);
    await sleep(1_600);
    const tally = await db.startTransaction().execute();
    expect(await world.tally(tally)).toEqual({ tallied: 1, elected: 1, vacant: 0 });
    const late = world.vote(ballot, b);
    const state = pending(late);
    await sleep(300);
    expect(state.settled).toBe(false);
    await tally.commit().execute();
    await expect(late).rejects.toMatchObject({ constraint: 'ballots_voting_period' });
    await ballot.rollback().execute();
  });
});
