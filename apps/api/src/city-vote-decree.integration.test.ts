import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  code,
  db,
  eventsOf,
  newWorld,
  owner,
  propose,
  rows,
  TAX,
} from './city-decree.integration-fixtures';
import { send } from './voyage.integration-fixtures';

// Vote d'un décret par les citoyens de la cité, contre Supabase local.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const vote = (user: string, decreeId: string, approve = true, key?: string) =>
  send(user, 'city.voteDecree', { decreeId, approve }, key);

describe('city.voteDecree', () => {
  it('un citoyen de la cité vote une fois pendant le vote ; ni la réponse ni l’événement ne disent son choix', async () => {
    const world = await newWorld();
    const [bob, metic, foreigner] = [
      await world.player(),
      await world.player(world.kalliste, false),
      await world.player(world.elaia),
    ];
    const decreeId = (await propose(world.alice.user, TAX)).body.data.decreeId as string;
    const key = randomUUID();
    const cast = await vote(bob.user, decreeId, false, key);
    expect(cast.status).toBe(200);
    expect(Object.keys(cast.body.data).sort()).toEqual(['castAt', 'decreeId']);
    expect(await vote(bob.user, decreeId, false, key)).toEqual(cast);
    expect(code(await vote(bob.user, decreeId, true))).toBe('ALREADY_VOTED');
    expect(code(await vote(metic.user, decreeId))).toBe('NOT_CITIZEN');
    expect(code(await vote(foreigner.user, decreeId))).toBe('NOT_CITIZEN');
    expect(code(await vote(bob.user, randomUUID()))).toBe('DECREE_NOT_FOUND');
    expect(await eventsOf('DecreeVoteCast', decreeId)).toEqual([
      { decreeId, cityId: world.kalliste, houseId: bob.houseId },
    ]);
    // Vote clos : fin du vote avancée, garde levée le temps de le faire.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.decrees disable trigger decrees_guard`.execute(trx);
      await sql`update game.decrees set proposed_at = now() - interval '3 days', voting_closes_at = now() - interval '1 minute' where id = ${decreeId}`.execute(
        trx,
      );
      await sql`alter table game.decrees enable trigger decrees_guard`.execute(trx);
    });
    expect(code(await vote(world.alice.user, decreeId))).toBe('VOTING_CLOSED');
  });

  it('votes concurrents : un seul vote par maison, et chaque maison est comptée', async () => {
    const world = await newWorld();
    const voters = await Promise.all([1, 2, 3, 4, 5].map(() => world.player()));
    const decreeId = (await propose(world.alice.user, TAX)).body.data.decreeId as string;
    const same = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => vote(world.alice.user, decreeId, n % 2 === 0)),
    );
    expect(same.map(code).sort()).toEqual([
      'ALREADY_VOTED',
      'ALREADY_VOTED',
      'ALREADY_VOTED',
      'ALREADY_VOTED',
      'ok',
    ]);
    const many = await Promise.all(voters.map((voter) => vote(voter.user, decreeId)));
    expect(many.map(code)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    const [count] = await rows(sql<{ votes: number; houses: number }>`select count(*)::int as votes,
      count(distinct house_id)::int as houses from game.decree_votes where decree_id = ${decreeId}`);
    expect(count).toEqual({ votes: 6, houses: 6 });
  });
});
