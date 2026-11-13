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
