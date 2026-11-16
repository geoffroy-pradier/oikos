import { shareRoundedUp } from './tax';

/**
 * Marché du travail et logement des travailleurs (docs/specs/04-systemes-gestion.md, 4.4 et 4.5 ; #258) :
 * calculs purs, en entiers. La clôture fixe chaque jour, par cité, le salaire et le prix de l'hébergement
 * chez les PNJ ; les commandes refusent un site qui demanderait plus de travailleurs que la cité n'en
 * offre.
 */
const BPS = 10_000;

/**
 * Une courbe de prix : un multiplicateur en points de base (10 000 : ×1) qui part de `minBps` et monte de
 * `slopeBps` quand le taux mesuré passe de 0 à 100 %, sans dépasser `maxBps`.
 */
export interface PriceCurve {
  minBps: number;
  maxBps: number;
  slopeBps: number;
}

const checkCount = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative integer`);
};

function checkCurve(curve: PriceCurve) {
  for (const name of ['minBps', 'maxBps', 'slopeBps'] as const) checkCount(curve[name], name);
  if (curve.minBps > curve.maxBps) throw new RangeError('minBps must not exceed maxBps');
}

/** ⌊a × b ÷ c⌋ en entiers longs : le produit peut dépasser les entiers sûrs, pas le résultat. */
const mulDiv = (a: number, b: number, c: number) => Number((BigInt(a) * BigInt(b)) / BigInt(c));

/**
 * Multiplicateur de la courbe pour un taux en points de base : `minBps + ⌊slopeBps × taux ÷ 10 000⌋`,
 * borné à `maxBps`. `null` : au-delà de 100 % (plus de demande que d'offre), la borne haute.
 */
export function curveBps(curve: PriceCurve, rateBps: number | null): number {
  checkCurve(curve);
  if (rateBps === null) return curve.maxBps;
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > BPS)
    throw new RangeError(`rateBps must be an integer from 0 to ${BPS}, or null`);
  return Math.min(curve.maxBps, curve.minBps + mulDiv(curve.slopeBps, rateBps, BPS));
}

/**
 * Offre de travail d'une cité : pour chaque classe travailleuse, la part de sa population qui travaille,
 * arrondie à l'habitant inférieur, sommée. Sans classe travailleuse (`workingShareBps` vide), l'offre est
 * sans limite (`null`) ; une classe sans population n'offre personne.
 */
export function laborSupply(
  populationOf: (classId: string) => number,
  workingShareBps: Readonly<Record<string, number>>,
): number | null {
  const shares = Object.entries(workingShareBps);
  if (shares.length === 0) return null;
  let supply = 0;
  for (const [classId, share] of shares) {
    if (!Number.isSafeInteger(share) || share < 0 || share > BPS)
      throw new RangeError(`share of ${classId} must be an integer from 0 to ${BPS}`);
    const population = populationOf(classId);
    checkCount(population, `population of ${classId}`);
    supply += mulDiv(population, share, BPS);
  }
  if (!Number.isSafeInteger(supply)) throw new RangeError('labor supply is too large');
  return supply;
}

/**
 * Taux d'emploi d'une cité, en points de base : travailleurs employés ÷ offre, arrondi au point
 * inférieur. Offre sans limite : 0. `null` : plus d'employés que l'offre (population tombée sous
 * l'emploi), qui met le salaire à sa borne haute. Une offre nulle sans employé est à 0.
 */
export function employmentRateBps(employed: number, supply: number | null): number | null {
  checkCount(employed, 'employed');
  if (supply === null) return 0;
  checkCount(supply, 'supply');
  if (employed > supply) return null;
  return supply === 0 ? 0 : mulDiv(employed, BPS, supply);
}

/**
 * Le salaire du jour d'une cité (4.4) : le salaire de base de la cité (`staff.dailyWageOboles`) multiplié
 * par la courbe du salaire au taux d'emploi, arrondi à l'obole supérieure (les salaires sont détruits :
 * l'arrondi ne joue jamais en faveur de la monnaie en circulation). Croissant avec l'emploi, décroissant
 * avec l'offre, toujours entre ⌈base × min⌉ et ⌈base × max⌉.
 */
export function equilibriumWage(input: {
  baseOboles: number;
  employed: number;
  supply: number | null;
  curve: PriceCurve;
}): number {
  checkCount(input.baseOboles, 'baseOboles');
  const rate = employmentRateBps(input.employed, input.supply);
  return shareRoundedUp(input.baseOboles, curveBps(input.curve, rate));
}

/**
 * Pénurie de logements d'une cité, en points de base : travailleurs non logés ÷ travailleurs employés,
 * arrondi au point inférieur ; nulle sans travailleur.
 */
export function housingShortageBps(workers: number, unhoused: number): number {
  checkCount(workers, 'workers');
  checkCount(unhoused, 'unhoused');
  if (unhoused > workers) throw new RangeError('unhoused must not exceed workers');
  return workers === 0 ? 0 : mulDiv(unhoused, BPS, workers);
}

/**
 * Prix d'une nuit d'hébergement chez les PNJ pour un travailleur sans logement, dans une cité (4.5) : le
 * prix de base multiplié par la courbe de l'hébergement à la pénurie de logements de la cité, arrondi à
 * l'obole supérieure (la monnaie est détruite). Croissant avec la pénurie, borné comme le salaire.
 */
export function lodgingPrice(input: {
  baseOboles: number;
  workers: number;
  unhoused: number;
  curve: PriceCurve;
}): number {
  checkCount(input.baseOboles, 'baseOboles');
  const shortage = housingShortageBps(input.workers, input.unhoused);
  return shareRoundedUp(input.baseOboles, curveBps(input.curve, shortage));
}

export interface SiteWorkforce {
  siteId: string;
  workers: number;
}

export interface HousedSite extends SiteWorkforce {
  housed: number;
  unhoused: number;
}

/**
 * Les logements d'une maison dans une cité logent les travailleurs de ses sites de cette cité, les plus
 * anciens d'abord (ordre reçu : date de création, puis identifiant) : chaque site prend ce qui reste,
 * jusqu'à ses travailleurs. Le reste n'est pas logé. Les parts font toujours les travailleurs.
 */
export function allocateHousing(units: number, sites: readonly SiteWorkforce[]): HousedSite[] {
  checkCount(units, 'units');
  if (new Set(sites.map((site) => site.siteId)).size !== sites.length)
    throw new RangeError('each site is housed once');
  let left = units;
  return sites.map((site) => {
    checkCount(site.workers, `workers of ${site.siteId}`);
    const housed = Math.min(left, site.workers);
    left -= housed;
    return { ...site, housed, unhoused: site.workers - housed };
  });
}
