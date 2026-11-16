import {
  CITY_VOTE_DECREE_ERROR_CODES,
  cityVoteDecreeInputSchema,
  cityVoteDecreeOutputSchema,
} from '@oikos/contracts';
import { defineCommand } from '../registry';
import { houseOf, NOT_CITIZEN, refuse } from './city-election';

/**
 * Vote d'un décret (6.3) : un citoyen de la cité du décret, pendant le vote, pour ou contre, une fois par
 * maison. Le vote est secret : ni la réponse ni l'événement ne disent le choix. Sous concurrence, la base
 * garantit l'unicité du vote et sa période (garde des votes, qui verrouille le décret en partage).
 */
const VOTING_CLOSED = { code: 'VOTING_CLOSED', message: 'The vote is not open.' };

export const cityVoteDecree = defineCommand({
  name: 'city.voteDecree',
  input: cityVoteDecreeInputSchema,
  output: cityVoteDecreeOutputSchema,
  errors: CITY_VOTE_DECREE_ERROR_CODES,
  errorByConstraint: {
    decree_votes_one_per_house: { code: 'ALREADY_VOTED', message: 'This house already voted.' },
    decree_votes_voting_period: VOTING_CLOSED,
    decree_votes_citizens_only: NOT_CITIZEN,
  },
  async handler({ trx, userId, emit, now }, input) {
    const house = await houseOf(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const decree = await trx
      .selectFrom('game.decrees')
      .select(['id', 'city_id', 'status', 'voting_closes_at'])
      .where('id', '=', input.decreeId)
      .where('world_id', '=', house.world_id)
      .executeTakeFirst();
    if (!decree) return refuse('DECREE_NOT_FOUND', 'Unknown decree.');
    if (house.status !== 'citizen' || house.city_id !== decree.city_id)
      return { ok: false, error: NOT_CITIZEN };
    if (decree.status !== 'proposed' || now >= decree.voting_closes_at)
      return { ok: false, error: VOTING_CLOSED };
    const voted = await trx
      .selectFrom('game.decree_votes')
      .select('id')
      .where('decree_id', '=', decree.id)
      .where('house_id', '=', house.id)
      .executeTakeFirst();
    if (voted) return refuse('ALREADY_VOTED', 'This house already voted.');
    const vote = await trx
      .insertInto('game.decree_votes')
      .values({ decree_id: decree.id, house_id: house.id, approve: input.approve })
      .returning('cast_at')
      .executeTakeFirstOrThrow();
    emit({
      type: 'DecreeVoteCast',
      payload: { decreeId: decree.id, cityId: decree.city_id, houseId: house.id },
    });
    return { ok: true, data: { decreeId: decree.id, castAt: vote.cast_at.toISOString() } };
  },
});
