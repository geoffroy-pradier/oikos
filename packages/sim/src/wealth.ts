/**
 * Fortune d'une maison et inégalité des fortunes (docs/specs/04-systemes-gestion.md, 4.1 ; 05-economie.md, 5.5) :
 * fonctions pures, en entiers. La base calcule la même fortune (`game.house_wealth`) ; un test d'intégration
 * vérifie qu'elles s'accordent sur les mêmes données.
 */
import type { Fraction } from './price-index';

/**
 * Un stock de la maison : quantité, part réservée par les ventes en attente comprise, et prix observé de sa cité ; ou
 * la cargaison d'un voyage en mer, au prix observé de sa cité d'arrivée (#719).
 */
export interface WealthStock {
  quantity: bigint;
  /** Prix de référence observé du bien dans la cité du stock (5.3), `null` s'il n'en a jamais eu. */
  unitPrice: bigint | null;
}

export interface HouseWealthInput {
  /** Solde du compte de trésorerie, en oboles. */
  treasury: bigint;
  /** Solde du compte de séquestre, en oboles (nul sans compte). */
  escrow: bigint;
  stocks: readonly WealthStock[];
  /**
   * Reste dû des prêts de la maison (#724), principal et intérêts, en oboles ; nul sans prêt. Il se déduit de la
   * fortune, qui peut alors être négative.
   */
  debt?: bigint;
  /**
   * Coffre de la banque de la maison (#726), net des dépôts qu'elle doit (#727), en oboles ; nul sans banque. La
   * monnaie du coffre reste à la maison qui l'a versée, moins ce qu'elle doit à ses déposants : il peut être négatif.
   */
  vault?: bigint;
  /** Dépôts de la maison dans les banques (#727), intérêts compris, en oboles : une créance, comptée dans sa fortune. */
  deposits?: bigint;
}

export interface HouseWealth {
  treasury: bigint;
  escrow: bigint;
  /** Valeur des stocks qui ont un prix observé. */
  stockValue: bigint;
  /** Nombre de stocks non vides sans prix observé, que la valeur ignore. */
  unpricedStocks: number;
  /** Reste dû des prêts de la maison. */
  debt: bigint;
  /** Coffre de sa banque, net des dépôts qu'elle doit. */
  vault: bigint;
  /** Ses dépôts dans les banques. */
  deposits: bigint;
  /** Trésorerie, séquestre, valeur des stocks, coffre net et dépôts, moins le reste dû. */
  wealth: bigint;
}

/**
 * Fortune d'une maison, comme son bilan (4.1) : trésorerie, séquestre et stocks valorisés au prix observé de
 * leur cité, cargaisons en mer comprises (#719), que le bilan ignore, coffre de sa banque net des dépôts qu'elle doit
 * (#726, #727) et dépôts de la maison (#727), moins le reste dû de ses prêts (#724). Un dépôt compte une fois : pour le
 * déposant, et en moins dans le coffre de sa banque. Un stock
 * vide ne compte pas ; un stock sans prix n'a pas de valeur, aucun prix n'est inventé, et il est compté à part. Sites,
 * navires et biens immobiliers n'y entrent pas.
 */
export function houseWealth({
  treasury,
  escrow,
  stocks,
  debt = 0n,
  vault = 0n,
  deposits = 0n,
}: HouseWealthInput): HouseWealth {
  if (debt < 0n) throw new RangeError('debt must not be negative');
  if (deposits < 0n) throw new RangeError('deposits must not be negative');
  let [stockValue, unpricedStocks] = [0n, 0];
  for (const { quantity, unitPrice } of stocks) {
    if (quantity <= 0n) continue;
    if (unitPrice === null) unpricedStocks += 1;
    else stockValue += quantity * unitPrice;
  }
  return {
    treasury,
    escrow,
    stockValue,
    unpricedStocks,
    debt,
    vault,
    deposits,
    wealth: treasury + escrow + stockValue + vault + deposits - debt,
  };
}

/**
 * Coefficient de Gini des fortunes, en fraction exacte : Σᵢ Σⱼ |xᵢ − xⱼ| ÷ (2 n Σ x), calculé sur les fortunes
 * triées, (2 Σ i·x₍ᵢ₎ − (n + 1) Σ x) ÷ (n Σ x). Une fortune négative (une dette, plus tard) compte pour zéro :
 * le coefficient reste entre 0 et (n − 1) ÷ n. `null` sans aucune fortune ; nul quand toutes sont nulles.
 */
export function giniFraction(wealths: readonly bigint[]): Fraction | null {
  const n = BigInt(wealths.length);
  if (n === 0n) return null;
  const sorted = wealths.map((w) => (w < 0n ? 0n : w)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let [total, weighted] = [0n, 0n];
  sorted.forEach((w, index) => {
    total += w;
    weighted += BigInt(index + 1) * w;
  });
  if (total === 0n) return [0n, 1n];
  return [2n * weighted - (n + 1n) * total, n * total];
}

/**
 * Coefficient de Gini en points de base (0 : fortunes égales ; vers 10 000 : une maison a tout), arrondi au
 * point le plus proche, le demi-point vers le haut. `null` sans aucune fortune.
 */
export function giniBps(wealths: readonly bigint[]): number | null {
  const gini = giniFraction(wealths);
  if (!gini) return null;
  const [numerator, denominator] = gini;
  return Number((20_000n * numerator + denominator) / (2n * denominator));
}

/** Une maison du classement : sa fortune, et si c'est une maison PNJ de secours. */
export interface RankedWealth {
  npc: boolean;
  wealth: bigint;
}

/**
 * Inégalité des fortunes d'un ensemble de maisons (un monde, une cité) : nombre de maisons comptées et Gini.
 * Les maisons PNJ de secours n'y entrent pas, comme dans tout classement de fortune.
 */
export function wealthInequality(houses: readonly RankedWealth[]): {
  houses: number;
  giniBps: number | null;
} {
  const counted = houses.filter((house) => !house.npc).map((house) => house.wealth);
  return { houses: counted.length, giniBps: giniBps(counted) };
}
