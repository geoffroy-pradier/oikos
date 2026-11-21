/**
 * Liturgies (docs/specs/06-cites-politique-communaute.md, 6.4 ; #719) : désignation des maisons les plus riches de
 * chaque cité et dû de chacune. Fonctions pures, en entiers ; les règles viennent de la configuration (`liturgies`).
 */
import { createRng } from './rng';

/** Ce dont dépend le dû : part de la fortune en points de base, dû minimal et maximal, en oboles. */
export interface LiturgyDueRules {
  dueShareBps: number;
  minDue: number;
  maxDue: number;
}

/** Quotient entier arrondi vers le haut, quel que soit le signe du dividende (diviseur positif). */
function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return quotient * denominator < numerator ? quotient + 1n : quotient;
}

/**
 * Dû d'une liturgie : la part `dueShareBps` de la fortune, arrondie à l'obole supérieure, ramenée entre `minDue` et
 * `maxDue`. Croissant (au sens large) avec la fortune ; une fortune nulle ou négative doit le dû minimal.
 */
export function liturgyDue(wealth: bigint, rules: LiturgyDueRules): bigint {
  const share = ceilDiv(wealth * BigInt(rules.dueShareBps), 10_000n);
  const [min, max] = [BigInt(rules.minDue), BigInt(rules.maxDue)];
  if (min > max) throw new RangeError(`Invalid liturgy due bounds [${min}, ${max}]`);
  return share < min ? min : share > max ? max : share;
}

/** Une maison qui peut être désignée : sa cité de foyer, sa fortune et son rang d'ancienneté (0 : la plus ancienne). */
export interface LiturgyCandidate {
  houseId: string;
  cityId: string;
  wealth: bigint;
  seniority: number;
}

/**
 * Maisons désignées : dans chaque cité, les `housesPerCity` plus riches dont la fortune atteint `wealthFloor`, à
 * égalité la plus ancienne, puis le plus petit identifiant. Le résultat ne dépend pas de l'ordre des candidates ; il
 * est rangé par cité, puis par rang dans la cité. Écarter les maisons qui ne peuvent pas l'être (PNJ, exclues) est
 * l'affaire de l'appelant.
 */
export function designateLiturgies<T extends LiturgyCandidate>(
  candidates: readonly T[],
  rules: { housesPerCity: number; wealthFloor: number },
): T[] {
  const floor = BigInt(rules.wealthFloor);
  const ranked = candidates
    .filter((candidate) => candidate.wealth >= floor)
    .sort(
      (a, b) =>
        compare(a.cityId, b.cityId) ||
        (a.wealth > b.wealth ? -1 : a.wealth < b.wealth ? 1 : 0) ||
        a.seniority - b.seniority ||
        compare(a.houseId, b.houseId),
    );
  const taken = new Map<string, number>();
  return ranked.filter((candidate) => {
    const count = taken.get(candidate.cityId) ?? 0;
    if (count >= rules.housesPerCity) return false;
    taken.set(candidate.cityId, count + 1);
    return true;
  });
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Genre d'une liturgie, tiré dans la liste de la configuration par une graine de la maison et de la saison : rejoué,
 * le tirage est le même. Il ne change que le libellé.
 */
export function liturgyGenre<G>(
  worldSeed: string,
  season: number,
  houseId: string,
  genres: readonly G[],
): G {
  return createRng(`${worldSeed}:liturgy:${season}:${houseId}`).pick(genres);
}
