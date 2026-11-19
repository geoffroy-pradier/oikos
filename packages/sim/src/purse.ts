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

/**
 * Revenu d'un tick des classes d'une cité (5.2, « Budget ») : Σ revenu pour 1 000 habitants × population ÷ 1 000,
 * arrondi à l'obole supérieure. C'est le plafond de la dépense du tick que la bourse doit couvrir.
 */
export function tickIncome(
  classes: readonly { incomePerThousand: number; population: number }[],
): number {
  let total = 0n;
  for (const { incomePerThousand, population } of classes) {
    if (!Number.isSafeInteger(incomePerThousand) || incomePerThousand < 0)
      throw new RangeError('Income must be a non-negative integer');
    if (!Number.isSafeInteger(population) || population < 0)
      throw new RangeError('Population must be a non-negative integer');
    total += BigInt(incomePerThousand) * BigInt(population);
  }
  const income = (total + 999n) / 1_000n;
  if (income > MAX) throw new RangeError('Tick income exceeds safe integers');
  return Number(income);
}

/**
 * Budget d'un bien borné par la bourse des PNJ de la cité (5.2, #632) : inchangé si la bourse couvre le revenu du
 * tick des classes (`tickIncome`), sinon réduit dans la proportion bourse ÷ revenu, arrondi à l'obole inférieure.
 * Tous les budgets d'un tick sont réduits dans la même proportion : la somme des budgets de son panier, avant les
 * hausses des fêtes et des caravanes, ne dépasse alors pas la bourse. Une bourse vide n'achète rien.
 */
export function purseBudget(budget: number, purse: number, income: number): number {
  for (const value of [budget, purse, income])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError('Budget, purse and income must be non-negative integers');
  if (purse >= income) return budget;
  return Number((BigInt(budget) * BigInt(purse)) / BigInt(income));
}
