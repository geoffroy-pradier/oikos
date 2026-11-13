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
  if (price <= 0 || referencePrice <= 0) throw new RangeError('Prices must be positive');
  const base = (quantityPerThousand * population) / 1000;
  const priceFactor = (price / referencePrice) ** -elasticity;
  const qualityFactor = 1 + (qualitySensitivity * (quality - NEUTRAL_QUALITY)) / NEUTRAL_QUALITY;
  return Math.max(0, base * priceFactor * qualityFactor);
}

/**
 * Convertit une demande réelle en unités entières, en reportant la fraction au tick suivant :
 * une demande de 1,86 par tick achète 1, puis 2, puis 2… sans jamais créer ni perdre de demande.
 */
export function wholeUnits(demand: number, carry: number): { units: number; carry: number } {
  const total = demand + carry;
  const units = Math.floor(total + 1e-9);
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

/**
 * Achats des PNJ dans un carnet de ventes. Les offres sont servies de la moins chère à la plus chère ;
 * à chaque niveau de prix, les PNJ ne détiennent jamais plus que ce qu'ils demanderaient à ce prix
 * (`demandAt` décroît avec le prix). Chaque achat se fait au prix demandé par le vendeur.
 */
export function matchNpcDemand(asks: readonly Ask[], demandAt: (price: number) => number): Fill[] {
  const fills: Fill[] = [];
  let bought = 0;
  // À prix égal, l'ordre fourni (le plus ancien d'abord) est conservé : le tri de JavaScript est stable.
  for (const ask of [...asks].sort((a, b) => a.price - b.price)) {
    const wanted = Math.floor(demandAt(ask.price)) - bought;
    if (wanted <= 0) break;
    const quantity = Math.min(wanted, ask.quantity);
    if (quantity > 0) {
      fills.push({ orderId: ask.orderId, price: ask.price, quantity });
      bought += quantity;
    }
  }
  return fills;
}
