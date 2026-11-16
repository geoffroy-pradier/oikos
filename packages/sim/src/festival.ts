/**
 * Fêtes de la cité (docs/specs/07-dieux-faveur-evenements.md, 7.5 ; 05-economie.md, 5.2 ; #263) : une fête
 * appliquée fait monter, pendant ses jours de jeu, la demande des PNJ de sa cité pour ses biens. Calcul pur,
 * en entiers ; les règles viennent de la configuration en vigueur (`decrees.models.festival`).
 */
export interface AppliedFestival {
  /** Montant voté, en oboles. */
  amountOboles: number;
  /** Durée votée, en jours de jeu. */
  days: number;
  goodIds: readonly string[];
  /** Jour de jeu de la clôture qui l'a appliquée : son premier jour. */
  settledDay: number;
}

export interface FestivalRules {
  maxOboles: number;
  maxDays: number;
  /** Hausse d'une fête de `maxOboles` en un jour, en points de base ; absente, aucune hausse. */
  demandBoostBps?: number | undefined;
}

/**
 * Hausse de la demande de chaque bien d'une cité au jour de jeu `gameDay`, en points de base. Une fête dure
 * ses jours votés, au plus `maxDays`, à partir du jour de sa clôture. Sa hausse est la part de `demandBoostBps`
 * que fait sa dépense par jour, ⌊demandBoostBps × montant ÷ (maxOboles × jours)⌋, montant ramené au plus à
 * `maxOboles` : jamais plus que `demandBoostBps`, arrondie vers le bas. Les hausses de plusieurs fêtes d'un
 * même bien s'ajoutent, ensemble au plus `demandBoostBps`. Sans règles (modèle fermé), aucune hausse.
 */
export function festivalDemandBoosts(
  festivals: readonly AppliedFestival[],
  gameDay: number,
  rules: FestivalRules | undefined,
): Map<string, number> {
  const boosts = new Map<string, number>();
  const ceiling = rules?.demandBoostBps ?? 0;
  if (!rules || ceiling <= 0) return boosts;
  for (const festival of festivals) {
    const days = Math.min(festival.days, rules.maxDays);
    if (!(days >= 1) || gameDay < festival.settledDay || gameDay >= festival.settledDay + days)
      continue;
    const amount = BigInt(Math.min(festival.amountOboles, rules.maxOboles));
    const boost = Number((BigInt(ceiling) * amount) / (BigInt(rules.maxOboles) * BigInt(days)));
    for (const goodId of new Set(festival.goodIds))
      boosts.set(goodId, Math.min(ceiling, (boosts.get(goodId) ?? 0) + boost));
  }
  return boosts;
}

/** Demande relevée de `boostBps` points de base (nombre réel, comme la demande). */
export function boostedDemand(demand: number, boostBps: number): number {
  return (demand * (10_000 + boostBps)) / 10_000;
}

/** Budget relevé de `boostBps` points de base, arrondi à l'obole inférieure : jamais plus que la hausse. */
export function boostedBudget(budget: number, boostBps: number): number {
  if (!Number.isSafeInteger(budget) || budget < 0) throw new RangeError(`Invalid budget ${budget}`);
  if (!Number.isInteger(boostBps) || boostBps < 0)
    throw new RangeError(`Invalid boost ${boostBps}`);
  return Number((BigInt(budget) * BigInt(10_000 + boostBps)) / 10_000n);
}
