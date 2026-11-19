/**
 * Bourse des PNJ d'une cité (docs/specs/05-economie.md, 5.2 et 5.5 ; #632) : calculs purs, en oboles entières.
 */

/** Ce que le revenu public lit d'une classe de PNJ : son revenu par tick, sa part publique et sa population. */
export interface PublicIncomeClass {
  /** Revenu par tick pour 1 000 habitants, en oboles. */
  incomePerThousand: number;
  /** Revenu public d'un jour, en points de base du revenu d'un jour de la classe. */
  publicIncomeBps: number;
  population: number;
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Revenu public d'un jour d'une cité, que le robinet `faucet_npc_public_income` verse à sa bourse à la clôture :
 * pour chaque classe, revenu par tick × ticks d'un jour × population ÷ 1 000 × part publique ÷ 10 000, sommé
 * sur les classes puis arrondi une fois à l'obole inférieure. Exact en entiers ; une part nulle ne verse rien.
 */
export function dailyPublicIncome(
  classes: readonly PublicIncomeClass[],
  ticksPerDay: number,
): number {
  if (!Number.isSafeInteger(ticksPerDay) || ticksPerDay < 0)
    throw new RangeError('Ticks per day must be a non-negative integer');
  let total = 0n;
  for (const { incomePerThousand, publicIncomeBps, population } of classes) {
    for (const value of [incomePerThousand, publicIncomeBps, population])
      if (!Number.isSafeInteger(value) || value < 0)
        throw new RangeError('Income, share and population must be non-negative integers');
    total += BigInt(incomePerThousand) * BigInt(population) * BigInt(publicIncomeBps);
  }
  const income = (total * BigInt(ticksPerDay)) / 10_000_000n;
  if (income > MAX) throw new RangeError('Public income exceeds safe integers');
  return Number(income);
}
