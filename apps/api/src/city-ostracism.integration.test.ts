import { randomUUID } from 'node:crypto';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appWithConfig,
  code,
  db,
  DECREES,
  newWorld,
  owner,
  propose,
  rows,
  TAX,
} from './city-decree.integration-fixtures';
import { TEST_CONFIG } from './test-config';
import { send } from './voyage.integration-fixtures';

// Ostracisme (6.4, #722) contre Supabase local : proposition, bulletins, effets d'un ostracisme sur les charges.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const RULES = { votingDays: 3, quorumBps: 3000, ostracismDays: 7, intervalDays: 28 };
const open = appWithConfig((config) => ({
  ...config,
  decrees: { ...DECREES, models: { ...DECREES.models, ostracism: RULES } },
}));
const OSTRACISM = { model: 'ostracism', params: {} };
const clock = TEST_CONFIG.config.clock;
const cast = (user: string, ostracismId: string, houseId: string, key?: string) =>
  send(user, 'city.castOstracon', { ostracismId, houseId }, key);
/** Écrit garde levée : `game.<table>`, le temps d'une requête. */
const unguarded = (table: string, query: ReturnType<typeof sql>) =>
  owner.transaction().execute(async (trx) => {
    await sql`alter table ${sql.table(`game.${table}`)} disable trigger ${sql.ref(`${table}_guard`)}`.execute(
      trx,
    );
    await query.execute(trx);
    await sql`alter table ${sql.table(`game.${table}`)} enable trigger ${sql.ref(`${table}_guard`)}`.execute(
      trx,
    );
  });

/** Un vote d'ostracisme de Kallistè, ouvert à `openedAt` par un décret adopté, et ce décret. */
async function vote(world: Awaited<ReturnType<typeof newWorld>>, openedAt: Date, closesAt: Date) {
  const decreeId = (await propose(world.alice.user, OSTRACISM, undefined, open)).body.data
    .decreeId as string;
  await unguarded(
    'decrees',
    sql`update game.decrees set status = 'adopted', tallied_at = now(), electorate = 0, votes_for = 0, votes_against = 0
      where id = ${decreeId}`,
  );
  const id = randomUUID();
  await unguarded(
    'ostracisms',
    sql`insert into game.ostracisms (id, world_id, city_id, decree_id, opened_at, voting_closes_at, quorum_bps, ostracism_days)
      values (${id}, ${world.worldId}, ${world.kalliste}, ${decreeId}, ${openedAt}, ${closesAt}, 3000, 7)`,
  );
  return { decreeId, ostracismId: id };
}
/** Dépouille un vote garde levée : la maison est ostracisée jusqu'à `endsAt` (personne si nulle). */
const tally = (ostracismId: string, houseId: string | null, endsAt: Date | null) =>
  unguarded(
    'ostracisms',
    sql`update game.ostracisms set tallied_at = least(now(), voting_closes_at + interval '1 second'), electorate = 0,
      ballots = 0, outcome = ${houseId ? 'ostracized' : 'tie'}, ostracized_house_id = ${houseId}, ends_at = ${endsAt}
      where id = ${ostracismId}`,
  );
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

describe('city.castOstracon', () => {
  it('un citoyen inscrit le nom d’un citoyen de sa cité, une fois ; ni la réponse ni l’événement ne le disent', async () => {
    const world = await newWorld();
    const [bob, metic, foreigner] = [
      await world.player(),
      await world.player(world.kalliste, false),
      await world.player(world.elaia),
    ];
    const { ostracismId } = await vote(world, hours(-1), hours(48));
    const key = randomUUID();
    const first = await cast(bob.user, ostracismId, world.alice.houseId, key);
    expect(first.status).toBe(200);
    expect(Object.keys(first.body.data).sort()).toEqual(['castAt', 'ostracismId']);
    expect(await cast(bob.user, ostracismId, world.alice.houseId, key)).toEqual(first);
    expect(code(await cast(bob.user, ostracismId, bob.houseId))).toBe('ALREADY_VOTED');
    expect(code(await cast(metic.user, ostracismId, bob.houseId))).toBe('NOT_CITIZEN');
    expect(code(await cast(foreigner.user, ostracismId, bob.houseId))).toBe('NOT_CITIZEN');
    expect(code(await cast(world.alice.user, ostracismId, metic.houseId))).toBe(
      'TARGET_NOT_CITIZEN',
    );
    expect(code(await cast(world.alice.user, ostracismId, foreigner.houseId))).toBe(
      'TARGET_NOT_CITIZEN',
    );
    expect(code(await cast(world.alice.user, randomUUID(), bob.houseId))).toBe(
      'OSTRACISM_NOT_FOUND',
    );
    const events = await rows(sql<{
      payload: Record<string, unknown>;
    }>`select payload from game.domain_events
      where type = 'OstraconCast' and payload->>'ostracismId' = ${ostracismId}`);
    expect(events.map((event) => event.payload)).toEqual([
      { ostracismId, cityId: world.kalliste, houseId: bob.houseId },
    ]);
    await unguarded(
      'ostracisms',
      sql`update game.ostracisms set voting_closes_at = now() - interval '1 minute' where id = ${ostracismId}`,
    );
    expect(code(await cast(world.alice.user, ostracismId, bob.houseId))).toBe('VOTING_CLOSED');
  });

  it('bulletins concurrents : un seul par maison, chaque maison comptée', async () => {
    const world = await newWorld();
    const voters = await Promise.all([1, 2, 3, 4].map(() => world.player()));
    const { ostracismId } = await vote(world, hours(-1), hours(48));
    const same = await Promise.all(
      voters.map((voter) => cast(world.alice.user, ostracismId, voter.houseId)),
    );
    expect(same.map(code).sort()).toEqual([
      'ALREADY_VOTED',
      'ALREADY_VOTED',
      'ALREADY_VOTED',
      'ok',
    ]);
    const many = await Promise.all(
      voters.map((voter) => cast(voter.user, ostracismId, world.alice.houseId)),
    );
    expect(many.map(code)).toEqual(['ok', 'ok', 'ok', 'ok']);
    const [count] = await rows(sql<{ n: number; houses: number }>`select count(*)::int as n,
      count(distinct house_id)::int as houses from game.ostraca where ostracism_id = ${ostracismId}`);
    expect(count).toEqual({ n: 5, houses: 5 });
  });
});

describe('proposition d’un ostracisme', () => {
  it('fermé au départ ; au plus un par année de jeu, compté de clôture en clôture', async () => {
    const world = await newWorld();
    expect(code(await propose(world.alice.user, OSTRACISM))).toBe('DECREE_MODEL_CLOSED');
    const { decreeId, ostracismId } = await vote(world, hours(-1), hours(48));
    // Au vote, puis adopté sans vote ouvert, puis vote ouvert : refusé.
    expect(code(await propose(world.alice.user, OSTRACISM, undefined, open))).toBe(
      'OSTRACISM_TOO_SOON',
    );
    await unguarded('ostracisms', sql`delete from game.ostracisms where id = ${ostracismId}`);
    expect(code(await propose(world.alice.user, OSTRACISM, undefined, open))).toBe(
      'OSTRACISM_TOO_SOON',
    );
    const today = gameDayAt(new Date(), clock);
    const reopen = (days: number) =>
      unguarded(
        'ostracisms',
        sql`insert into game.ostracisms (id, world_id, city_id, decree_id, opened_at, voting_closes_at, quorum_bps, ostracism_days)
          values (${ostracismId}, ${world.worldId}, ${world.kalliste}, ${decreeId},
            ${new Date(dailyCloseAt(today - days, clock).getTime() + 60_000)}, now() - interval '1 day', 3000, 7)`,
      );
    await reopen(27);
    expect(code(await propose(world.alice.user, OSTRACISM, undefined, open))).toBe(
      'OSTRACISM_TOO_SOON',
    );
    await tally(ostracismId, null, null);
    expect(code(await propose(world.alice.user, OSTRACISM, undefined, open))).toBe(
      'OSTRACISM_TOO_SOON',
    );
    // Ouvert à la clôture d'il y a vingt-huit jours de jeu : une année est passée.
    await unguarded(
      'ostracisms',
      sql`update game.ostracisms set opened_at = ${dailyCloseAt(today - 28, clock)} where id = ${ostracismId}`,
    );
    const again = await propose(world.alice.user, OSTRACISM, undefined, open);
    expect(again.body.data).toMatchObject({ cityId: world.kalliste, model: 'ostracism' });
    // Un autre modèle n'est pas concerné.
    expect(code(await propose(world.alice.user, TAX, undefined, open))).toBe('ok');
  });

  it('propositions concurrentes : un seul ostracisme au vote', async () => {
    const world = await newWorld();
    const replies = await Promise.all(
      [1, 2, 3].map(() => propose(world.alice.user, OSTRACISM, undefined, open)),
    );
    expect(replies.map(code).sort()).toEqual(['OSTRACISM_TOO_SOON', 'OSTRACISM_TOO_SOON', 'ok']);
  });
});

describe('effets d’un ostracisme sur les charges', () => {
  it('ostracisée, une maison ne propose ni ne se présente ; elle le peut de nouveau à la fin', async () => {
    const world = await newWorld();
    const bob = await world.player();
    const { ostracismId } = await vote(world, hours(-72), hours(-1));
    await tally(ostracismId, world.alice.houseId, hours(24 * 7));
    const electionId = randomUUID();
    await sql`insert into game.elections (id, world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
      values (${electionId}, ${world.worldId}, ${world.kalliste}, 'archon', now() - interval '1 day', now() + interval '3 days',
        now() + interval '6 days', now() + interval '34 days')`.execute(owner);
    const stand = (user: string) => send(user, 'city.standForElection', { electionId });
    expect(code(await propose(world.alice.user, TAX))).toBe('OSTRACIZED');
    expect(code(await stand(world.alice.user))).toBe('OSTRACIZED');
    expect(code(await stand(bob.user))).toBe('ok');
    // Fin de l'ostracisme.
    await unguarded(
      'ostracisms',
      sql`update game.ostracisms set ends_at = now() - interval '1 minute' where id = ${ostracismId}`,
    );
    expect(code(await stand(world.alice.user))).toBe('ok');
    expect(code(await propose(world.alice.user, TAX))).toBe('ok');
    // Une charge quittée ne propose plus.
    await unguarded(
      'offices',
      sql`update game.offices set vacated_at = now() where house_id = ${world.alice.houseId}`,
    );
    expect(code(await propose(world.alice.user, TAX))).toBe('NOT_ARCHON');
  });
});
