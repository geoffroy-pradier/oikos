import { z } from 'zod';

const id = z.string().min(1);
const instant = z.string().min(1);
const votes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Élection d'une charge de la cité (vue publique `elections`, 6.2). Instants en millisecondes. */
export interface Election {
  id: string;
  cityId: string;
  office: string;
  candidacyOpensAt: number;
  votingOpensAt: number;
  votingClosesAt: number;
  termEndsAt: number;
  talliedAt: number | null;
}

/**
 * Où en est une élection à un instant : dépôt des candidatures pas encore ouvert, dépôt, vote, vote clos en
 * attente du dépouillement à la clôture, dépouillée.
 */
export type ElectionPhase = 'upcoming' | 'filing' | 'voting' | 'counting' | 'tallied';

const time = (value: string) => {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};
const at = instant.transform((value, ctx) => {
  const ms = time(value);
  if (ms === null) ctx.addIssue({ code: 'custom', message: 'not an instant' });
  return ms ?? 0;
});

const electionRow = z.object({
  id,
  city_id: id,
  office: z.string().min(1),
  candidacy_opens_at: at,
  voting_opens_at: at,
  voting_closes_at: at,
  term_ends_at: at,
  tallied_at: at.nullable(),
});

/** Élections lues, des plus récentes aux plus anciennes ; `null` si une ligne est illisible. */
export function parseElections(rows: unknown): Election[] | null {
  const parsed = z.array(electionRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .map((row) => ({
      id: row.id,
      cityId: row.city_id,
      office: row.office,
      candidacyOpensAt: row.candidacy_opens_at,
      votingOpensAt: row.voting_opens_at,
      votingClosesAt: row.voting_closes_at,
      termEndsAt: row.term_ends_at,
      talliedAt: row.tallied_at,
    }))
    .sort((a, b) => b.candidacyOpensAt - a.candidacyOpensAt);
}

export function electionPhase(election: Election, now: number): ElectionPhase {
  if (election.talliedAt !== null) return 'tallied';
  if (now < election.candidacyOpensAt) return 'upcoming';
  if (now < election.votingOpensAt) return 'filing';
  if (now < election.votingClosesAt) return 'voting';
  return 'counting';
}

/** Élection en cours : la plus récente qui n'est pas dépouillée, s'il y en a une. */
export const currentElection = (elections: readonly Election[]) =>
  elections.find((election) => election.talliedAt === null) ?? null;

/** Candidature maintenue ou retirée (vue publique `election_candidates`). */
export interface Candidate {
  id: string;
  electionId: string;
  houseId: string;
  withdrawn: boolean;
}

const candidateRow = z.object({
  id,
  election_id: id,
  house_id: id,
  withdrawn_at: instant.nullable(),
});

export function parseCandidates(rows: unknown): Candidate[] | null {
  const parsed = z.array(candidateRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    id: row.id,
    electionId: row.election_id,
    houseId: row.house_id,
    withdrawn: row.withdrawn_at !== null,
  }));
}

/** Voix d'une candidature après le dépouillement (vue publique `election_results`). */
export interface Result {
  electionId: string;
  houseId: string;
  votes: number;
  elected: boolean;
}

const resultRow = z.object({
  election_id: id,
  house_id: id,
  votes,
  elected: z.boolean(),
});

/** Résultats, élus d'abord puis par voix décroissantes ; `null` si une ligne est illisible. */
export function parseResults(rows: unknown): Result[] | null {
  const parsed = z.array(resultRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .map((row) => ({
      electionId: row.election_id,
      houseId: row.house_id,
      votes: row.votes,
      elected: row.elected,
    }))
    .sort((a, b) => Number(b.elected) - Number(a.elected) || b.votes - a.votes);
}

/** Charge pourvue (vue publique `offices`) ; `inOffice` : en cours à l'instant de la lecture. */
export interface Office {
  houseId: string;
  office: string;
  endsAt: number;
  inOffice: boolean;
}

const officeRow = z.object({
  house_id: id,
  office: z.string().min(1),
  ends_at: at,
  in_office: z.boolean(),
});

export function parseOffices(rows: unknown): Office[] | null {
  const parsed = z.array(officeRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data.map((row) => ({
    houseId: row.house_id,
    office: row.office,
    endsAt: row.ends_at,
    inOffice: row.in_office,
  }));
}

/** Élections (ou décrets) où la maison a déjà voté (`my_ballots`, `my_decree_votes`) : jamais pour qui. */
export function parseVoted(rows: unknown, key: 'election_id' | 'decree_id'): Set<string> | null {
  const parsed = z.array(z.object({ [key]: id })).safeParse(rows);
  if (!parsed.success) return null;
  return new Set(parsed.data.map((row) => String(row[key])));
}

/** Noms des maisons de la cité (vue publique `houses`), par identifiant. */
export function parseHouseNames(rows: unknown): Map<string, string> | null {
  const parsed = z.array(z.object({ id, name: z.string().min(1) })).safeParse(rows);
  if (!parsed.success) return null;
  return new Map(parsed.data.map((row) => [row.id, row.name]));
}

/** Citoyenneté de la maison du joueur et sa date (vue `my_citizenships`, #420). */
export interface Citizenship {
  status: 'metic' | 'citizen';
  /** Instant du statut, en millisecondes. */
  since: number;
  /** Jour de jeu du statut (jours depuis 1970-01-01), `null` sans horloge en vigueur. */
  sinceDay: number | null;
}

const citizenshipRow = z.object({
  house_id: id,
  status: z.enum(['metic', 'citizen']),
  since: at,
  since_day: z.number().int().min(0).max(2_932_896).nullable(),
});

/**
 * Citoyenneté de la maison `houseId` : `undefined` si la vue n'en rend pas (maison sans cité), `null` si une
 * ligne est illisible.
 */
export function parseCitizenship(rows: unknown, houseId: string): Citizenship | null | undefined {
  const parsed = z.array(citizenshipRow).safeParse(rows);
  if (!parsed.success) return null;
  const row = parsed.data.find((candidate) => candidate.house_id === houseId);
  return row && { status: row.status, since: row.since, sinceDay: row.since_day };
}

/** Statut de citoyenneté de la maison, relu dans la vue `houses` ; `null` s'il est illisible. */
export function statusOf(rows: unknown[], houseId: string): 'metic' | 'citizen' | null {
  const row = rows.find(
    (candidate): candidate is { id: string; citizenship_status: unknown } =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'id' in candidate &&
      candidate.id === houseId,
  );
  return row?.citizenship_status === 'citizen' || row?.citizenship_status === 'metic'
    ? row.citizenship_status
    : null;
}
