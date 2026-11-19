/**
 * Demande finale des PNJ (docs/specs/05-economie.md, 5.2) :
 *   Q = Q0 · N · (P / Pref)^(-ε) · (1 + β · (q - 50) / 50)
 * Les coefficients viennent de la configuration ; aucun n'est écrit ici.
 */
export interface DemandInput {
  /** Q0 : quantité par tick pour 1 000 habitants, au prix de référence. */
  quantityPerThousand: number;
  /** N : population de la classe. */
  population: number;
  /** P : prix offert, en oboles. */
  price: number;
  /** Pref : prix de référence du bien, en oboles. */
  referencePrice: number;
  /** ε : élasticité-prix du bien. */
  elasticity: number;
  /** β : sensibilité de la classe à la qualité. */
  qualitySensitivity: number;
  /** q : qualité du bien, de 0 à 100. */
  quality: number;
}

/** Qualité neutre : le facteur de qualité vaut 1. */
export const NEUTRAL_QUALITY = 50;

/** Quantité demandée par une classe pour un tick, en nombre réel (jamais négative). */
export function classDemand(input: DemandInput): number {
  const {
    quantityPerThousand,
    population,
    price,
    referencePrice,
    elasticity,
    qualitySensitivity,
    quality,
  } = input;
  if (!(price > 0) || !(referencePrice > 0) || !Number.isFinite(price))
    throw new RangeError('Prices must be positive');
  if (!(quality >= 0 && quality <= 100)) throw new RangeError('Quality must be between 0 and 100');
  const base = (quantityPerThousand * population) / 1000;
  const priceFactor = (price / referencePrice) ** -elasticity;
  const qualityFactor = 1 + (qualitySensitivity * (quality - NEUTRAL_QUALITY)) / NEUTRAL_QUALITY;
  return Math.max(0, base * priceFactor * qualityFactor);
}

export interface BudgetClass {
  /** N : population de la classe dans la cité. */
  population: number;
  /** Revenu de la classe, en oboles par tick pour 1 000 habitants. */
  incomePerThousand: number;
  basket: readonly { goodId: string; quantityPerThousand: number }[];
}

/**
 * Budget des PNJ d'une cité pour un bien et un tick, en oboles entières (5.2). Le revenu de chaque classe
 * est réparti entre les biens de son panier au prorata de leur dépense de référence (Q0 × prix de
 * référence). L'arrondi est fait vers le bas : les PNJ ne dépensent jamais plus que leur revenu. Ce que le
 * tick ne dépense pas se reporte, borné (`nextBudgetCarry`, `offeredNpcBudget`).
 */
export function npcGoodBudget(
  classes: readonly BudgetClass[],
  goodId: string,
  referencePrice: (goodId: string) => number,
): number {
  let budget = 0;
  for (const { population, incomePerThousand, basket } of classes) {
    if (!(population >= 0) || !(incomePerThousand >= 0))
      throw new RangeError('Population and income must be non-negative');
    const spending = (entry: { goodId: string; quantityPerThousand: number }) => {
      const value = entry.quantityPerThousand * referencePrice(entry.goodId);
      if (!(value > 0) || !Number.isFinite(value))
        throw new RangeError(`Invalid reference spending for ${entry.goodId}`);
      return value;
    };
    const total = basket.reduce((sum, entry) => sum + spending(entry), 0);
    const wanted = basket.find((entry) => entry.goodId === goodId);
    if (!wanted) continue;
    budget += ((incomePerThousand * population) / 1000) * (spending(wanted) / total);
  }
  return Math.floor(budget + EPSILON);
}

/** Tolérance d'arrondi flottant : 2,9999999999 unités demandées en valent 3. */
const EPSILON = 1e-9;

/**
 * Convertit une demande réelle en unités entières, en reportant la fraction au tick suivant :
 * une demande de 1,86 par tick achète 1, puis 2, puis 2… sans jamais créer ni perdre de demande.
 */
export function wholeUnits(demand: number, carry: number): { units: number; carry: number } {
  if (!Number.isFinite(demand) || demand < 0)
    throw new RangeError('Demand must be a finite, non-negative number');
  if (!(carry >= 0 && carry < 1)) throw new RangeError('Carry must be in [0, 1)');
  const total = demand + carry;
  const units = Math.floor(total + EPSILON);
  return { units, carry: Math.max(0, total - units) };
}

export interface Ask {
  orderId: string;
  /** Prix limite du vendeur, en oboles par unité. */
  price: number;
  quantity: number;
}

export interface Fill {
  orderId: string;
  price: number;
  quantity: number;
}

export interface NpcPurchaseInput {
  /** Offres de vente du carnet, de la plus ancienne à la plus récente. */
  asks: readonly Ask[];
  /** Demande réelle du tick à un prix donné (somme des classes) ; décroît avec le prix. */
  demandAt: (price: number) => number;
  /** Budget du tick, en oboles : les PNJ ne dépensent jamais plus que leur revenu. */
  budget: number;
  /** Fraction de demande reportée du tick précédent, dans [0, 1). */
  carry: number;
}

export interface NpcPurchase {
  fills: Fill[];
  /** Dépense totale, en oboles : c'est la monnaie créée par le robinet des achats de PNJ. */
  spent: number;
  /** Fraction de demande à reporter au tick suivant. */
  carry: number;
}

/**
 * Achats des PNJ dans un carnet de ventes, pour un tick. Les offres sont servies de la moins chère à la
 * plus chère (la plus ancienne d'abord à prix égal), chacune au prix demandé par le vendeur. Deux bornes :
 * - à chaque niveau de prix, la quantité cumulée ne dépasse pas la demande à ce prix (courbe décroissante) ;
 * - la dépense totale ne dépasse pas le budget, quel que soit le prix demandé.
 */
export function matchNpcDemand({ asks, demandAt, budget, carry }: NpcPurchaseInput): NpcPurchase {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw new RangeError('Budget must be a non-negative integer');
  const fills: Fill[] = [];
  let [bought, spent, nextCarry] = [0, 0, carry];
  // À prix égal, l'ordre fourni est conservé : le tri de JavaScript est stable.
  for (const ask of [...asks].sort((a, b) => a.price - b.price)) {
    if (
      !Number.isSafeInteger(ask.price) ||
      ask.price <= 0 ||
      !Number.isSafeInteger(ask.quantity) ||
      ask.quantity < 0
    ) {
      throw new RangeError(`Invalid ask ${ask.orderId}`);
    }
    const demand = wholeUnits(demandAt(ask.price), carry);
    nextCarry = demand.carry;
    const wanted = demand.units - bought;
    if (wanted <= 0) break;
    const affordable = Math.floor((budget - spent) / ask.price);
    const quantity = Math.min(wanted, ask.quantity, affordable);
    if (quantity > 0) {
      fills.push({ orderId: ask.orderId, price: ask.price, quantity });
      bought += quantity;
      spent += quantity * ask.price;
    }
    // Budget épuisé à ce prix : les offres suivantes sont au moins aussi chères.
    if (affordable <= Math.min(wanted, ask.quantity)) break;
  }
  return { fills, spent, carry: nextCarry };
}

/**
 * Budget non dépensé d'un tick, reporté au tick suivant (5.2, #675). Les biens s'achètent par unités entières :
 * un budget de 13 oboles ne paie qu'un sel à 7, et sans report les 6 oboles restantes seraient perdues alors que
 * la demande en veut deux un tick sur deux. `allowance` est ce à quoi le tick avait droit (son budget et le report
 * précédent), `cap` la borne du report (`budgetCarryCap`). Le report ne vient que du revenu des ticks déjà joués :
 * sur la durée, les PNJ ne dépensent jamais plus que leur revenu cumulé.
 */
export function nextBudgetCarry(allowance: number, spent: number, cap: number): number {
  for (const value of [allowance, spent, cap])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError('Allowance, spending and cap must be non-negative integers');
  if (spent > allowance) throw new RangeError('Spending exceeds the allowance');
  return Math.min(allowance - spent, cap);
}

/**
 * Borne du report de budget : `units` unités au prix de réserve du bien, le plus haut prix que les PNJ paient
 * (`market.npcBudgetCarryUnits` ; zéro, aucun report). Le report ne devient pas une épargne qui grossit pendant
 * une pénurie, et la dépense d'un tick ne dépasse jamais son budget de plus de `units` unités.
 */
export function budgetCarryCap(reservePrice: number, units: number): number {
  if (![reservePrice, units].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new RangeError('Reserve price and units must be non-negative integers');
  const cap = reservePrice * units;
  if (!Number.isSafeInteger(cap)) throw new RangeError('Budget carry cap is too large');
  return cap;
}

export interface OfferedBudgetInput {
  /** Budget du tick pour le bien, déjà réduit par la bourse et relevé par les fêtes et caravanes. */
  tickBudget: number;
  /** Report du budget non dépensé, déjà ramené à sa borne. */
  carry: number;
  /** Ce qui reste dans la bourse de la cité à ce point du tick. */
  remaining: number;
  /** Somme des budgets du tick des biens de la cité qui restent à servir après celui-ci. */
  reserved: number;
}

/**
 * Budget offert aux PNJ d'une cité pour un bien, à un tick (5.2, #632, #675) : son budget du tick, plus le report
 * dans la seule limite de l'excédent de la bourse sur les budgets du tick de ce bien et des biens qui restent à
 * servir. Une bourse courte garde ainsi à chaque bien sa part proportionnelle, quel que soit l'ordre de service ;
 * jamais plus que ce qui reste dans la bourse.
 */
export function offeredNpcBudget({ tickBudget, carry, remaining, reserved }: OfferedBudgetInput) {
  for (const value of [tickBudget, carry, remaining, reserved])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError('Budgets, carry and purse must be non-negative integers');
  const surplus = Math.max(0, remaining - reserved - tickBudget);
  return Math.min(tickBudget + Math.min(carry, surplus), remaining);
}
