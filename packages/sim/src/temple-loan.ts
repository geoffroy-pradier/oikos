/**
 * Trésor du temple (docs/specs/05-economie.md, 5.4 ; #724) : intérêt d'un prêt, plafond du principal par la Timè et
 * partage d'un remboursement, en entiers. La base vérifie la même règle d'intérêt et le même partage (`game.loans`).
 */

/** Points de base d'un taux entier, jours d'une année : conversions d'unités, pas d'équilibrage. */
const BPS = 10_000n;
const DAYS_PER_YEAR = 365n;

const positive = (value: bigint, name: string) => {
  if (value <= 0n) throw new RangeError(`${name} must be positive`);
};
const safe = (value: number, name: string, min: number) => {
  if (!Number.isSafeInteger(value) || value < min) throw new RangeError(`${name} is out of range`);
};

/**
 * Intérêt simple d'un prêt, fixé à l'emprunt pour toute sa durée : principal × taux annuel (points de base) × jours ÷
 * (10 000 × 365), arrondi à l'obole supérieure ; l'arrondi ne joue jamais en faveur de la monnaie créée. Nul à un taux
 * nul, au moins une obole à tout taux positif.
 */
export function templeLoanInterest(principal: bigint, rateBps: number, termDays: number): bigint {
  positive(principal, 'principal');
  safe(rateBps, 'rateBps', 0);
  safe(termDays, 'termDays', 1);
  const numerator = principal * BigInt(rateBps) * BigInt(termDays);
  const denominator = BPS * DAYS_PER_YEAR;
  return (numerator + denominator - 1n) / denominator;
}

/** Un palier de Timè : à partir de `minHonor`, un principal d'au plus `maxPrincipal` oboles. */
export interface HonorCreditTier {
  minHonor: number;
  maxPrincipal: number;
}

/**
 * Plus grand principal que le temple prête à une maison de Timè `honor` : le plafond du plus haut palier qu'elle atteint
 * (paliers par Timè croissante, comme la configuration les tient) ; zéro sous le premier palier ou sans palier.
 */
export function templeLoanCap(honor: number, tiers: readonly HonorCreditTier[]): number {
  safe(honor, 'honor', Number.MIN_SAFE_INTEGER);
  let cap = 0;
  for (const tier of tiers) if (honor >= tier.minHonor) cap = tier.maxPrincipal;
  return cap;
}

/**
 * Partage d'un remboursement de `amount` oboles d'un prêt dont il reste `interestDue` oboles d'intérêts : intérêts
 * d'abord, au plus ce qui en reste, puis le principal.
 */
export function splitLoanRepayment(
  amount: bigint,
  interestDue: bigint,
): { interest: bigint; principal: bigint } {
  positive(amount, 'amount');
  if (interestDue < 0n) throw new RangeError('interestDue must not be negative');
  const interest = amount < interestDue ? amount : interestDue;
  return { interest, principal: amount - interest };
}
