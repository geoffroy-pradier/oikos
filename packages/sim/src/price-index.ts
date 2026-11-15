/**
 * Indice des prix du tableau de bord économique (docs/specs/05-economie.md, 5.5) : fonctions pures.
 * Un prix moyen est un rapport (montant échangé ÷ unités) : le calcul reste en fractions d'entiers
 * exactes jusqu'à l'arrondi final, car arrondir à l'obole un bien à 6 oboles fausserait l'indice de 8 %.
 */

/** Échanges d'un bien sur une période : montant brut en oboles et unités échangées. */
export interface Traded {
  turnover: bigint;
  volume: bigint;
}
/** Fraction exacte, dénominateur strictement positif. */
export type Fraction = readonly [numerator: bigint, denominator: bigint];

/**
 * Coût du panier sur une période : Σ quantité × montant ÷ unités. `null` si le panier est vide ou si
 * l'un de ses biens ne s'est pas échangé à un prix positif : jamais de prix inventé.
 */
export function basketCost(
  basket: readonly { goodId: string; quantity: number }[],
  traded: ReadonlyMap<string, Traded>,
): Fraction | null {
  if (basket.length === 0) return null;
  let [numerator, denominator] = [0n, 1n];
  for (const { goodId, quantity } of basket) {
    const good = traded.get(goodId);
    if (!good || good.volume <= 0n || good.turnover <= 0n) return null;
    numerator = numerator * good.volume + BigInt(quantity) * good.turnover * denominator;
    denominator *= good.volume;
  }
  return [numerator, denominator];
}

/**
 * Rapport de deux coûts de panier, en points de base (10 000 : coûts égaux), arrondi au point le plus
 * proche, le demi-point vers le haut. `null` si l'un des deux coûts est inconnu.
 */
export function costRatioBps(cost: Fraction | null, base: Fraction | null): number | null {
  if (!cost || !base) return null;
  const [numerator, denominator] = [cost[0] * base[1] * 10_000n, cost[1] * base[0]];
  return Number((2n * numerator + denominator) / (2n * denominator));
}

export type InflationStatus = 'in_target' | 'below' | 'above' | 'unknown';

/** Situe une inflation, en points de base, par rapport à sa cible, bornes comprises. */
export function inflationStatus(
  inflationBps: number | null,
  target: { min: number; max: number },
): InflationStatus {
  if (inflationBps === null) return 'unknown';
  if (inflationBps < target.min) return 'below';
  return inflationBps > target.max ? 'above' : 'in_target';
}
