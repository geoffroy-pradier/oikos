import { z } from 'zod';

/**
 * Citoyenneté et élection de l'archonte (docs/specs/06-cites-politique-communaute.md, 6.2 ; #260).
 * Une maison métèque devient citoyenne d'elle-même, à la clôture (`CitizenshipGranted`).
 */
export const citizenshipGrantedSchema = z.strictObject({
  type: z.literal('CitizenshipGranted'),
  payload: z.strictObject({
    houseId: z.uuid(),
    cityId: z.uuid(),
    /** Jour de jeu dont la clôture l'a faite citoyenne. */
    gameDay: z.number().int().nonnegative(),
  }),
});

/**
 * Dépouillement d'une élection qui a un élu : la candidature maintenue qui a le plus de bulletins, la plus
 * ancienne en cas d'égalité. Une élection sans candidat ne produit pas d'événement : la charge reste vacante.
 */
export const archonElectedSchema = z.strictObject({
  type: z.literal('ArchonElected'),
  payload: z.strictObject({
    electionId: z.uuid(),
    cityId: z.uuid(),
    houseId: z.uuid(),
    /** Bulletins reçus par l'élu. */
    votes: z.number().int().nonnegative(),
    termStartsAt: z.iso.datetime(),
    termEndsAt: z.iso.datetime(),
  }),
});

/** Commande `city.standForElection` : la maison se porte candidate à une élection de sa cité. */
export const cityStandForElectionInputSchema = z.strictObject({ electionId: z.uuid() });
export type CityStandForElectionInput = z.infer<typeof cityStandForElectionInputSchema>;
export const cityStandForElectionOutputSchema = z.object({
  candidacyId: z.uuid(),
  electionId: z.uuid(),
  cityId: z.uuid(),
});
export type CityStandForElectionOutput = z.infer<typeof cityStandForElectionOutputSchema>;

/** Commande `city.withdrawCandidacy` : la maison retire sa candidature, pendant le dépôt. Définitif. */
export const cityWithdrawCandidacyInputSchema = z.strictObject({ electionId: z.uuid() });
export type CityWithdrawCandidacyInput = z.infer<typeof cityWithdrawCandidacyInputSchema>;
export const cityWithdrawCandidacyOutputSchema = z.object({
  candidacyId: z.uuid(),
  electionId: z.uuid(),
});
export type CityWithdrawCandidacyOutput = z.infer<typeof cityWithdrawCandidacyOutputSchema>;

/**
 * Commande `city.castVote` : la maison vote pour une candidature. Le vote est secret : la réponse, le
 * journal des événements et les lectures des joueurs ne rendent jamais la candidature choisie.
 */
export const cityCastVoteInputSchema = z.strictObject({
  electionId: z.uuid(),
  candidacyId: z.uuid(),
});
export type CityCastVoteInput = z.infer<typeof cityCastVoteInputSchema>;
export const cityCastVoteOutputSchema = z.object({
  electionId: z.uuid(),
  castAt: z.iso.datetime(),
});
export type CityCastVoteOutput = z.infer<typeof cityCastVoteOutputSchema>;

export const CITY_STAND_FOR_ELECTION_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Aucune élection de ce monde sous cet identifiant. */
  'ELECTION_NOT_FOUND',
  /** La maison n'est pas citoyenne de la cité de l'élection : métèque, ou citoyenne d'une autre cité. */
  'NOT_CITIZEN',
  /** Hors du dépôt des candidatures : pas encore ouvert, vote commencé ou élection dépouillée. */
  'FILING_CLOSED',
  /** La maison a déjà une candidature à cette élection, maintenue ou retirée. */
  'ALREADY_CANDIDATE',
  /** La maison a tenu la charge aux derniers mandats consécutifs autorisés (`maxConsecutiveTerms`). */
  'TERM_LIMIT_REACHED',
  /** La maison est ostracisée : elle ne se présente à aucune élection d'ici la fin de son ostracisme (#722). */
  'OSTRACIZED',
] as const;
export const CITY_WITHDRAW_CANDIDACY_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Aucune candidature maintenue de la maison à cette élection. */
  'CANDIDACY_NOT_FOUND',
  'FILING_CLOSED',
] as const;
export const CITY_CAST_VOTE_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  'ELECTION_NOT_FOUND',
  'NOT_CITIZEN',
  /** Hors du vote : pas encore ouvert, clos ou dépouillé. */
  'VOTING_CLOSED',
  /** Candidature absente de l'élection, ou retirée. */
  'CANDIDACY_NOT_FOUND',
  /** La maison a déjà voté à cette élection. */
  'ALREADY_VOTED',
] as const;

const candidacyPayload = z.strictObject({
  candidacyId: z.uuid(),
  electionId: z.uuid(),
  cityId: z.uuid(),
  houseId: z.uuid(),
});
export const candidacyFiledSchema = z.strictObject({
  type: z.literal('CandidacyFiled'),
  payload: candidacyPayload,
});
export const candidacyWithdrawnSchema = z.strictObject({
  type: z.literal('CandidacyWithdrawn'),
  payload: candidacyPayload,
});
/** Un bulletin est déposé : l'événement nomme la maison qui vote, jamais la candidature choisie. */
export const ballotCastSchema = z.strictObject({
  type: z.literal('BallotCast'),
  payload: z.strictObject({ electionId: z.uuid(), cityId: z.uuid(), houseId: z.uuid() }),
});
