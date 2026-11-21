import { OSTRACISM_OUTCOMES, type OstracismOutcome } from '@oikos/contracts';
import { z } from 'zod';

/**
 * Ostracisme lu par le client (6.4, 12). Le vote est secret : une maison ne lit que le fait qu'elle a voté et la date
 * (`my_ostraca`), jamais le nom qu'elle a inscrit ni le bulletin d'une autre ; le décompte par nom n'est lu qu'après
 * le dépouillement (`ostracism_results`).
 */

/** Où en est un vote d'ostracisme à un instant : au vote, clos en attente du dépouillement, dépouillé. */
export type OstracismPhase = 'voting' | 'counting' | 'tallied';

const id = z.string().min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.string().transform((value, ctx) => {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) ctx.addIssue({ code: 'custom', message: 'not an instant' });
  return ms;
});

/** Vote d'ostracisme d'une cité (vue `ostracisms`). Instants en millisecondes. */
export interface Ostracism {
  id: string;
  cityId: string;
  openedAt: number;
  votingClosesAt: number;
  /** Part des citoyens, en points de base, dont les bulletins rendent le vote valable (fixée à l'ouverture). */
  quorumBps: number;
  talliedAt: number | null;
  electorate: number | null;
  ballots: number | null;
  outcome: OstracismOutcome | null;
  ostracizedHouseId: string | null;
  endsAt: number | null;
  /** L'ostracisme court encore à l'instant de la lecture. */
  inForce: boolean;
}

const row = z.object({
  id,
  city_id: id,
  opened_at: instant,
  voting_closes_at: instant,
  quorum_bps: z.number().int().min(0).max(10_000),
  tallied_at: instant.nullable(),
  electorate: count.nullable(),
  ballots: count.nullable(),
  outcome: z.enum(OSTRACISM_OUTCOMES).nullable(),
  ostracized_house_id: id.nullable(),
  ends_at: instant.nullable(),
  in_force: z.boolean(),
});

/** Votes lus, du plus récent au plus ancien ; `null` si une ligne est illisible. */
export function parseOstracisms(rows: unknown): Ostracism[] | null {
  const parsed = z.array(row).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .map((entry) => ({
      id: entry.id,
      cityId: entry.city_id,
      openedAt: entry.opened_at,
      votingClosesAt: entry.voting_closes_at,
      quorumBps: entry.quorum_bps,
      talliedAt: entry.tallied_at,
      electorate: entry.electorate,
      ballots: entry.ballots,
      outcome: entry.outcome,
      ostracizedHouseId: entry.ostracized_house_id,
      endsAt: entry.ends_at,
      inForce: entry.in_force,
    }))
    .sort((a, b) => b.openedAt - a.openedAt);
}

/** Vote en cours (non dépouillé) s'il y en a un, sinon le dernier dépouillé ; `null` : la cité n'en a jamais eu. */
export const currentOstracism = (list: readonly Ostracism[]): Ostracism | null =>
  list.find((entry) => entry.talliedAt === null) ?? list[0] ?? null;

export function ostracismPhase(entry: Ostracism, now: number): OstracismPhase {
  if (entry.talliedAt !== null) return 'tallied';
  return now < entry.votingClosesAt ? 'voting' : 'counting';
}

/** Voix d'une maison nommée, lues après le dépouillement (vue `ostracism_results`). */
export interface OstracismResult {
  houseId: string;
  votes: number;
}

const resultRow = z.object({ ostracism_id: id, house_id: id, ostraca: count });

/** Décompte d'un vote, des plus nommées aux moins nommées (à égalité, l'ordre de lecture) ; `null` si illisible. */
export function parseOstracismResults(
  rows: unknown,
  ostracismId: string,
): OstracismResult[] | null {
  const parsed = z.array(resultRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .filter((entry) => entry.ostracism_id === ostracismId)
    .map((entry) => ({ houseId: entry.house_id, votes: entry.ostraca }))
    .sort((a, b) => b.votes - a.votes);
}

const castRow = z.object({ ostracism_id: id, cast_at: instant });

/**
 * Instant où la maison a voté ce vote, `null` si elle n'a pas voté ; le nom inscrit n'est pas lu. `undefined` si une
 * ligne est illisible.
 */
export function castAt(rows: unknown, ostracismId: string): number | null | undefined {
  const parsed = z.array(castRow).safeParse(rows);
  if (!parsed.success) return undefined;
  return parsed.data.find((entry) => entry.ostracism_id === ostracismId)?.cast_at ?? null;
}

/** Citoyens de la cité qu'on peut nommer : les maisons citoyennes dont le nom contient la saisie, sans casse ni accent. */
export function filterCitizens<T extends { name: string }>(
  citizens: readonly T[],
  query: string,
): T[] {
  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase();
  const wanted = fold(query.trim());
  return citizens
    .filter((citizen) => fold(citizen.name).includes(wanted))
    .sort((a, b) => a.name.localeCompare(b.name));
}
