import {
  CITY_STAND_FOR_ELECTION_ERROR_CODES,
  CITY_WITHDRAW_CANDIDACY_ERROR_CODES,
  cityStandForElectionInputSchema,
  cityStandForElectionOutputSchema,
  cityWithdrawCandidacyInputSchema,
  cityWithdrawCandidacyOutputSchema,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';
import { accountHouseId } from '@oikos/operations';

/**
 * Élection de l'archonte (docs/specs/06-cites-politique-communaute.md, 6.2). Les citoyens d'une cité se
 * présentent, se retirent et votent ; la clôture ouvre et dépouille les élections. Chaque refus est
 * d'abord vérifié ici, puis par la base, qui fait foi sous concurrence (gardes des candidatures et des
 * bulletins, unicité) : ses refus reviennent sous le même code.
 */

export const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});

/** La maison du compte (la plus ancienne d'un compte hérité, #604), sa cité et son statut. */
export const houseOf = (trx: Db, userId: string) =>
  trx
    .selectFrom('game.houses as h')
    .innerJoin('game.citizenships as c', 'c.house_id', 'h.id')
    .select(['h.id', 'h.world_id', 'c.city_id', 'c.status'])
    .where('h.id', '=', accountHouseId(userId))
    .executeTakeFirst();

/** Une élection du monde de la maison. */
export const electionOf = (trx: Db, worldId: string, electionId: string) =>
  trx
    .selectFrom('game.elections')
    .select([
      'id',
      'city_id',
      'candidacy_opens_at',
      'voting_opens_at',
      'voting_closes_at',
      'tallied_at',
    ])
    .where('id', '=', electionId)
    .where('world_id', '=', worldId)
    .executeTakeFirst();

export type Election = NonNullable<Awaited<ReturnType<typeof electionOf>>>;
const filing = (election: Election, now: Date) =>
  !election.tallied_at && election.candidacy_opens_at <= now && now < election.voting_opens_at;
export const voting = (election: Election, now: Date) =>
  !election.tallied_at && election.voting_opens_at <= now && now < election.voting_closes_at;

export const NOT_CITIZEN = { code: 'NOT_CITIZEN', message: 'Only citizens of the city take part.' };
const FILING_CLOSED = { code: 'FILING_CLOSED', message: 'Candidacies are not open.' };

export const cityStandForElection = defineCommand({
  name: 'city.standForElection',
  input: cityStandForElectionInputSchema,
  output: cityStandForElectionOutputSchema,
  errors: CITY_STAND_FOR_ELECTION_ERROR_CODES,
  errorByConstraint: {
    candidacies_one_per_house: { code: 'ALREADY_CANDIDATE', message: 'Already a candidate.' },
    candidacies_filing_period: FILING_CLOSED,
    candidacies_citizens_only: NOT_CITIZEN,
  },
  async handler({ trx, userId, emit, config, now }, input) {
    const house = await houseOf(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const election = await electionOf(trx, house.world_id, input.electionId);
    if (!election) return refuse('ELECTION_NOT_FOUND', 'Unknown election.');
    if (house.status !== 'citizen' || house.city_id !== election.city_id)
      return { ok: false, error: NOT_CITIZEN };
    if (!filing(election, now)) return { ok: false, error: FILING_CLOSED };
    const existing = await trx
      .selectFrom('game.candidacies')
      .select('id')
      .where('election_id', '=', election.id)
      .where('house_id', '=', house.id)
      .executeTakeFirst();
    if (existing) return refuse('ALREADY_CANDIDATE', 'Already a candidate.');
    // Mandats consécutifs : les élections précédentes de la cité, de la plus récente à la plus ancienne,
    // toutes gagnées par cette maison. Une charge vacante interrompt la suite. Toutes sont dépouillées :
    // la suivante ne s'ouvre qu'après le dépouillement de la précédente. Une version publiée avant la
    // citoyenneté ne borne rien.
    const limit = config.politics?.archon.maxConsecutiveTerms;
    if (limit !== undefined) {
      const previous = await trx
        .selectFrom('game.elections as e')
        .leftJoin('game.offices as o', 'o.election_id', 'e.id')
        .select('o.house_id')
        .where('e.city_id', '=', election.city_id)
        .where('e.office', '=', 'archon')
        .where('e.voting_closes_at', '<', election.voting_closes_at)
        .orderBy('e.voting_closes_at', 'desc')
        .limit(limit)
        .execute();
      if (previous.length === limit && previous.every((office) => office.house_id === house.id))
        return refuse('TERM_LIMIT_REACHED', `At most ${limit} consecutive terms.`);
    }
    const candidacy = await trx
      .insertInto('game.candidacies')
      .values({ election_id: election.id, house_id: house.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    const payload = {
      candidacyId: candidacy.id,
      electionId: election.id,
      cityId: election.city_id,
      houseId: house.id,
    };
    emit({ type: 'CandidacyFiled', payload });
    return {
      ok: true,
      data: { candidacyId: candidacy.id, electionId: election.id, cityId: election.city_id },
    };
  },
});

export const cityWithdrawCandidacy = defineCommand({
  name: 'city.withdrawCandidacy',
  input: cityWithdrawCandidacyInputSchema,
  output: cityWithdrawCandidacyOutputSchema,
  errors: CITY_WITHDRAW_CANDIDACY_ERROR_CODES,
  errorByConstraint: { candidacies_filing_period: FILING_CLOSED },
  async handler({ trx, userId, emit, now }, input) {
    const house = await houseOf(trx, userId);
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const election = await electionOf(trx, house.world_id, input.electionId);
    // Verrou de la candidature : deux retraits simultanés se suivent, le second ne la trouve plus.
    const candidacy = election
      ? await trx
          .selectFrom('game.candidacies')
          .select('id')
          .where('election_id', '=', election.id)
          .where('house_id', '=', house.id)
          .where('withdrawn_at', 'is', null)
          .forUpdate()
          .executeTakeFirst()
      : undefined;
    if (!election || !candidacy) return refuse('CANDIDACY_NOT_FOUND', 'No standing candidacy.');
    if (!filing(election, now)) return { ok: false, error: FILING_CLOSED };
    await trx
      .updateTable('game.candidacies')
      .set({ withdrawn_at: sql<Date>`now()` })
      .where('id', '=', candidacy.id)
      .execute();
    emit({
      type: 'CandidacyWithdrawn',
      payload: {
        candidacyId: candidacy.id,
        electionId: election.id,
        cityId: election.city_id,
        houseId: house.id,
      },
    });
    return { ok: true, data: { candidacyId: candidacy.id, electionId: election.id } };
  },
});
