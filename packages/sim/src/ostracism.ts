/** Décompte d'un vote d'ostracisme à sa clôture (docs/specs/06-cites-politique-communaute.md, 6.4 ; #722). */
export interface OstracismCount {
  /** Bulletins reçus par chaque maison nommée (aucune entrée pour une maison qui n'en a pas). */
  ostraca: Readonly<Record<string, number>>;
  /** Citoyens de la cité à la fin du vote. */
  electorate: number;
  /** Quorum fixé à l'ouverture du vote, en points de base des citoyens. */
  quorumBps: number;
}

export type OstracismDecision =
  | { outcome: 'ostracized'; quorumReached: true; ballots: number; houseId: string; votes: number }
  | { outcome: 'tie' | 'no_quorum'; quorumReached: boolean; ballots: number; houseId: null };

/**
 * Issue d'un ostracisme : le quorum est atteint quand les bulletins font au moins `quorumBps` des citoyens
 * (calcul exact en entiers longs, comme la base) ; la maison la plus nommée est alors ostracisée si elle est
 * seule en tête. Une égalité en tête, ou aucun bulletin, n'ostracise personne.
 */
export function ostracismOutcome(count: OstracismCount): OstracismDecision {
  const { ostraca, electorate, quorumBps } = count;
  const votes = Object.values(ostraca);
  for (const value of [...votes, electorate])
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid count ${value}`);
  if (!Number.isInteger(quorumBps) || quorumBps < 0 || quorumBps > 10_000)
    throw new RangeError(`Invalid quorum ${quorumBps}`);
  const ballots = votes.reduce((sum, value) => sum + value, 0);
  const quorumReached = BigInt(ballots) * 10_000n >= BigInt(quorumBps) * BigInt(electorate);
  if (!quorumReached) return { outcome: 'no_quorum', quorumReached, ballots, houseId: null };
  const top = Math.max(0, ...votes);
  const leaders = Object.keys(ostraca).filter((houseId) => ostraca[houseId] === top);
  const [houseId] = leaders;
  if (top === 0 || leaders.length !== 1 || houseId === undefined)
    return { outcome: 'tie', quorumReached, ballots, houseId: null };
  return { outcome: 'ostracized', quorumReached, ballots, houseId, votes: top };
}
