/**
 * Taxe de marché (docs/specs/05-economie.md, 5.3) : calcul pur, en oboles entières. Les deux arrondis
 * se font à l'obole supérieure, la taxe d'abord puis sa part détruite : jamais en faveur de la monnaie
 * qui reste en circulation, et découper un échange en plusieurs ne fait jamais payer moins.
 */
const BPS = 10_000;

export interface MarketTaxRule {
  /** Taux de la taxe, en points de base du montant brut. */
  rateBps: number;
  /** Part de la taxe détruite, en points de base ; le reste va au trésor de la cité. */
  burnShareBps: number;
}

export interface MarketTax {
  /** Ce que reçoit le vendeur : brut − détruit − trésor. */
  net: number;
  /** Part de la taxe détruite (puits). */
  burned: number;
  /** Part de la taxe versée au trésor de la cité. */
  treasury: number;
}

/**
 * ⌈amount × bps / 10 000⌉ sans quitter les entiers sûrs : le produit direct les dépasserait. Garde
 * technique, pas une règle de jeu : si un produit intermédiaire ou le résultat sortent des entiers
 * sûrs, le calcul est refusé plutôt que rendu faux.
 */
export function shareRoundedUp(amount: number, bps: number): number {
  const rest = amount % BPS;
  const share = ((amount - rest) / BPS) * bps + Math.ceil((rest * bps) / BPS);
  if (!Number.isSafeInteger(rest * bps) || !Number.isSafeInteger(share))
    throw new RangeError('amount × bps is too large');
  return share;
}

/** Répartit le montant brut d'un échange (prix × quantité) entre le vendeur, le puits et le trésor. */
export function marketTax(gross: number, rule: MarketTaxRule): MarketTax {
  if (!Number.isSafeInteger(gross) || gross <= 0)
    throw new RangeError('gross must be a positive integer');
  for (const name of ['rateBps', 'burnShareBps'] as const) {
    const bps = rule[name];
    if (!Number.isInteger(bps) || bps < 0 || bps > BPS)
      throw new RangeError(`${name} must be an integer between 0 and ${BPS}`);
  }
  const tax = shareRoundedUp(gross, rule.rateBps);
  const burned = shareRoundedUp(tax, rule.burnShareBps);
  return { net: gross - tax, burned, treasury: tax - burned };
}
