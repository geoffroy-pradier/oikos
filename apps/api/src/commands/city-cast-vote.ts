import {
  CITY_CAST_VOTE_ERROR_CODES,
  cityCastVoteInputSchema,
  cityCastVoteOutputSchema,
} from '@oikos/contracts';
import { defineCommand } from '../registry';
import { electionOf, houseOf, NOT_CITIZEN, refuse, voting } from './city-election';

/**
 * Vote à l'élection de l'archonte (6.2) : un citoyen de la cité, pendant le vote, pour une candidature
 * maintenue, une fois. Le vote est secret : ni la réponse ni l'événement ne nomment la candidature
 * choisie. Sous concurrence, la base garantit l'unicité du bulletin et sa période (garde des bulletins).
 */
export const cityCastVote = defineCommand({
  name: 'city.castVote',
  input: cityCastVoteInputSchema,
  output: cityCastVoteOutputSchema,
  errors: CITY_CAST_VOTE_ERROR_CODES,
  errorByConstraint: {
    ballots_one_per_house: { code: 'ALREADY_VOTED', message: 'This house already voted.' },
    ballots_voting_period: { code: 'VOTING_CLOSED', message: 'The vote is not open.' },
    ballots_citizens_only: NOT_CITIZEN,
    ballots_candidate_standing: {
      code: 'CANDIDACY_NOT_FOUND',
      message: 'No such standing candidacy.',
    },
  },
  async handler({ trx, userId, emit, now }, input) {
    const house = await houseOf(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const election = await electionOf(trx, house.world_id, input.electionId);
    if (!election) return refuse('ELECTION_NOT_FOUND', 'Unknown election.');
    if (house.status !== 'citizen' || house.city_id !== election.city_id)
      return { ok: false, error: NOT_CITIZEN };
    if (!voting(election, now)) return refuse('VOTING_CLOSED', 'The vote is not open.');
    const candidacy = await trx
      .selectFrom('game.candidacies')
      .select('id')
      .where('id', '=', input.candidacyId)
      .where('election_id', '=', election.id)
      .where('withdrawn_at', 'is', null)
      .executeTakeFirst();
    if (!candidacy) return refuse('CANDIDACY_NOT_FOUND', 'No such standing candidacy.');
    const voted = await trx
      .selectFrom('game.ballots')
      .select('id')
      .where('election_id', '=', election.id)
      .where('house_id', '=', house.id)
      .executeTakeFirst();
    if (voted) return refuse('ALREADY_VOTED', 'This house already voted.');
    const ballot = await trx
      .insertInto('game.ballots')
      .values({ election_id: election.id, house_id: house.id, candidacy_id: candidacy.id })
      .returning('cast_at')
      .executeTakeFirstOrThrow();
    emit({
      type: 'BallotCast',
      payload: { electionId: election.id, cityId: election.city_id, houseId: house.id },
    });
    return { ok: true, data: { electionId: election.id, castAt: ballot.cast_at.toISOString() } };
  },
});
