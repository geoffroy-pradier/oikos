/**
 * Population des PNJ (docs/specs/05-economie.md, 5.2) : calcul pur, en habitants entiers. La clôture
 * quotidienne s'en sert pour faire croître une classe dont les besoins vitaux sont couverts et en faire
 * émigrer une partie sinon.
 */

const FULL = 10_000;
/**
 * Plus grande population de classe que le calcul accepte : en deçà, `population × taux × couverture`
 * reste un entier sûr (≤ 10⁸ × 10³ × 10⁴ < 2⁵³). Limite technique, que le schéma de configuration reprend.
 */
export const MAX_CLASS_POPULATION = 100_000_000;

export interface PopulationDynamics {
  /** Couverture des besoins vitaux (points de base) à partir de laquelle la classe croît. */
  vitalCoverageThresholdBps: number;
  /** Croissance d'un jour à couverture complète, en points de base de la population. */
  growthBps: number;
  /** Émigration d'un jour à couverture nulle, en points de base de la population. */
  emigrationBps: number;
  /** Bornes de la population, en points de base de la population initiale de la configuration. */
  minShareBps: number;
  maxShareBps: number;
}

const assertCount = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CLASS_POPULATION)
    throw new RangeError(`${name} must be an integer between 0 and ${MAX_CLASS_POPULATION}`);
};

/**
 * Couverture du jour, en points de base : quantités servies sur quantités demandées, bornée à 100 %.
 * Rien de demandé : couverture complète (rien ne manquait).
 */
export function vitalCoverageBps(served: number, demanded: number): number {
  if (!(served >= 0) || !(demanded >= 0) || !Number.isFinite(served) || !Number.isFinite(demanded))
    throw new RangeError('served and demanded must be finite and non-negative');
  if (demanded === 0) return FULL;
  return Math.min(FULL, Math.floor((served * FULL) / demanded));
}

/**
 * Population d'une classe après un jour. Au-dessus du seuil, elle croît en proportion de l'excédent de
 * couverture (jusqu'à `growthBps` à 100 %) ; en dessous, elle décroît en proportion du manque (jusqu'à
 * `emigrationBps` à 0 %). La variation est arrondie vers zéro, à l'habitant entier, puis la population
 * est tenue entre ses bornes. Croissante en couverture et en population courante.
 */
export function nextPopulation(
  current: number,
  initial: number,
  coverageBps: number,
  dynamics: PopulationDynamics,
): number {
  assertCount(current, 'current');
  assertCount(initial, 'initial');
  if (!Number.isSafeInteger(coverageBps) || coverageBps < 0 || coverageBps > FULL)
    throw new RangeError('coverageBps must be an integer between 0 and 10000');
  const { vitalCoverageThresholdBps: threshold, growthBps, emigrationBps } = dynamics;
  let delta = 0;
  if (coverageBps >= threshold) {
    // Seuil à 100 % : seule une couverture complète fait croître, au taux plein.
    const span = FULL - threshold;
    const excess = span === 0 ? 1 : coverageBps - threshold;
    delta = Math.floor((current * growthBps * excess) / (FULL * (span === 0 ? 1 : span)));
  } else {
    delta = -Math.floor((current * emigrationBps * (threshold - coverageBps)) / (FULL * threshold));
  }
  const min = Math.floor((initial * dynamics.minShareBps) / FULL);
  // Le plafond en part de la population initiale ne dépasse jamais la limite technique d'une classe.
  const max = Math.min(MAX_CLASS_POPULATION, Math.floor((initial * dynamics.maxShareBps) / FULL));
  return Math.min(max, Math.max(min, current + delta));
}

export interface NeedClass {
  id: string;
  /** Population courante de la classe dans la cité. */
  population: number;
  basket: readonly { goodId: string; need: string; quantityPerThousand: number }[];
}

/**
 * Mesure d'un tick pour la couverture des besoins vitaux (5.2), par classe, en unités. Demandé : le
 * besoin de référence de ses biens vitaux (Q0 × N ÷ 1000, la demande au prix de référence). Servi : sa
 * part des unités achetées de ces biens, au prorata des besoins de référence de toutes les classes qui
 * veulent le bien, vital pour elles ou non. Il n'est jamais servi plus d'unités qu'il n'en a été acheté.
 */
export function vitalMeasure(
  classes: readonly NeedClass[],
  bought: ReadonlyMap<string, number>,
): { classId: string; served: number; demanded: number }[] {
  const need = ({ basket, population }: NeedClass, goodId: string) =>
    ((basket.find((e) => e.goodId === goodId)?.quantityPerThousand ?? 0) * population) / 1000;
  return classes.map((npcClass) => {
    let [served, demanded] = [0, 0];
    for (const { goodId, need: level } of npcClass.basket) {
      if (level !== 'vital') continue;
      const own = need(npcClass, goodId);
      const all = classes.reduce((sum, other) => sum + need(other, goodId), 0);
      demanded += own;
      if (own > 0) served += ((bought.get(goodId) ?? 0) * own) / all;
    }
    return { classId: npcClass.id, served, demanded };
  });
}
