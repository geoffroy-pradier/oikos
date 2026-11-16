import { dailyCloseAt, gameDayAt, type DayClock } from './clock';

/** Décompte d'un décret à la fin de son vote (docs/specs/06-cites-politique-communaute.md, 6.3). */
export interface DecreeCount {
  votesFor: number;
  votesAgainst: number;
  /** Citoyens de la cité à la fin du vote. */
  electorate: number;
  /** Quorum fixé à la proposition, en points de base des citoyens. */
  quorumBps: number;
}

/**
 * Issue d'un décret : le quorum est atteint quand les votes exprimés (pour et contre) font au moins
 * `quorumBps` des citoyens ; le décret est adopté si, de plus, les votes pour sont strictement plus
 * nombreux que les votes contre (une égalité rejette). Calcul exact en entiers longs : la base fait le même.
 */
export function decreeOutcome(count: DecreeCount): { quorumReached: boolean; adopted: boolean } {
  const { votesFor, votesAgainst, electorate, quorumBps } = count;
  for (const value of [votesFor, votesAgainst, electorate])
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid count ${value}`);
  if (!Number.isInteger(quorumBps) || quorumBps < 0 || quorumBps > 10_000)
    throw new RangeError(`Invalid quorum ${quorumBps}`);
  const cast = BigInt(votesFor) + BigInt(votesAgainst);
  const quorumReached = cast * 10_000n >= BigInt(quorumBps) * BigInt(electorate);
  return { quorumReached, adopted: quorumReached && votesFor > votesAgainst };
}

/**
 * Fin du vote d'un décret proposé à un instant : la clôture qui ouvre le jour de jeu
 * `g + votingDays + 1`, où g est le jour de la proposition. Le vote dure donc au moins `votingDays` jours
 * de jeu pleins (de la proposition à la clôture suivante, puis `votingDays` jours), et moins d'un jour de
 * plus : une proposition faite juste avant une clôture n'écourte pas le vote.
 */
export function decreeVotingClosesAt(proposedAt: Date, votingDays: number, clock: DayClock): Date {
  if (!Number.isSafeInteger(votingDays) || votingDays < 1)
    throw new RangeError(`Invalid voting days ${votingDays}`);
  return dailyCloseAt(gameDayAt(proposedAt, clock) + votingDays + 1, clock);
}

/**
 * Plafond d'un décret de dépense, en oboles : ⌊trésor × shareBps ÷ 10 000⌋, arrondi en faveur du trésor.
 * Un trésor nul (ou, par erreur, débiteur) ne permet aucune dépense.
 */
export function decreeSpendingCapOboles(treasury: bigint, shareBps: number): bigint {
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > 10_000)
    throw new RangeError(`Invalid share ${shareBps}`);
  return treasury <= 0n ? 0n : (treasury * BigInt(shareBps)) / 10_000n;
}
