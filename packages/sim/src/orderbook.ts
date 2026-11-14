/**
 * Appariement d'un ordre à cours limité (docs/specs/05-economie.md, 5.3) : priorité au meilleur prix,
 * puis au plus ancien. L'échange se fait au prix de l'ordre déjà présent dans le carnet.
 */
export type Side = 'buy' | 'sell';

export interface RestingOrder {
  orderId: string;
  /** Prix limite, en oboles par unité. */
  price: number;
  /** Quantité restante. */
  quantity: number;
  /** Rang d'arrivée : le plus petit est le plus ancien. */
  sequence: number;
}

export interface IncomingOrder {
  side: Side;
  price: number;
  quantity: number;
  /**
   * Achat seulement : somme disponible, en oboles. L'ordre s'exécute pour ce qu'elle permet de payer,
   * du moins cher au plus cher ; sans elle, l'achat n'est borné que par son prix limite.
   */
  budget?: number;
}

export interface Trade {
  restingOrderId: string;
  price: number;
  quantity: number;
}

export interface MatchResult {
  trades: Trade[];
  /** Quantité de l'ordre entrant non exécutée, à inscrire au carnet. */
  remaining: number;
  /** Vrai si une offre au prix limite restait à servir et que seul le budget l'a empêché. */
  shortOfFunds: boolean;
}

/** Apparie un ordre entrant contre le côté opposé du carnet. Ne modifie pas le carnet fourni. */
export function matchLimitOrder(
  incoming: IncomingOrder,
  opposite: readonly RestingOrder[],
): MatchResult {
  for (const [name, value] of Object.entries({
    price: incoming.price,
    quantity: incoming.quantity,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(`${name} must be a positive integer`);
  }
  const buying = incoming.side === 'buy';
  const { budget } = incoming;
  if (budget !== undefined && (!buying || !Number.isSafeInteger(budget) || budget < 0))
    throw new RangeError('budget must be a non-negative integer, for a buy order');
  const crosses = (resting: RestingOrder) =>
    buying ? resting.price <= incoming.price : resting.price >= incoming.price;
  const best = [...opposite]
    .filter((resting) => resting.quantity > 0 && crosses(resting))
    .sort((a, b) => (buying ? a.price - b.price : b.price - a.price) || a.sequence - b.sequence);

  const trades: Trade[] = [];
  let remaining = incoming.quantity;
  let funds = budget ?? Infinity;
  let shortOfFunds = false;
  for (const resting of best) {
    if (remaining === 0) break;
    const wanted = Math.min(remaining, resting.quantity);
    // Offres triées du moins cher au plus cher : ce qui ne se paie pas ici ne se paiera pas plus loin.
    const quantity = Math.min(wanted, Math.floor(funds / resting.price));
    if (quantity < wanted) shortOfFunds = true;
    if (quantity === 0) break;
    trades.push({ restingOrderId: resting.orderId, price: resting.price, quantity });
    remaining -= quantity;
    funds -= quantity * resting.price;
    if (shortOfFunds) break;
  }
  return { trades, remaining, shortOfFunds };
}
