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

interface OrderTerms {
  /** Prix limite, en oboles par unité. */
  price: number;
  quantity: number;
}

/**
 * Ordre entrant, pour l'appariement seul. `budget` (achat seulement) : somme disponible, en oboles ;
 * l'achat s'exécute pour ce qu'elle permet de payer, du moins cher au plus cher. Sans elle, l'appariement
 * n'est borné que par le prix limite : c'est l'appariement « à fonds illimités », que les tests comparent
 * à l'achat borné. Un ordre de joueur passe par `planLimitOrder`, qui exige le budget d'un achat.
 */
export type IncomingOrder =
  (OrderTerms & { side: 'buy'; budget?: number }) | (OrderTerms & { side: 'sell'; budget?: never });

/**
 * Ordre d'une maison à son arrivée (`planLimitOrder`) : un achat dit toujours son budget, la trésorerie
 * de la maison ; une vente n'en a pas.
 */
export type PlacedOrder = { houseId: string } & (
  (OrderTerms & { side: 'buy'; budget: number }) | (OrderTerms & { side: 'sell'; budget?: never })
);

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

/** Ordre du carnet, avec la maison qui l'a déposé. */
export interface HouseOrder extends RestingOrder {
  houseId: string;
}

export interface OrderPlan extends MatchResult {
  /** Vrai si le reste de l'ordre attend dans le carnet ; faux s'il est servi en entier ou annulé. */
  rests: boolean;
  /** Achat qui attend : somme à mettre sous séquestre (prix limite × reste). Zéro sinon. */
  escrow: number;
}

/**
 * Décide du sort d'un ordre à son arrivée (5.3). Une maison n'échange pas avec elle-même : ses propres
 * ordres sont ignorés. Le reste d'une vente attend toujours (son stock est réservé par l'appelant). Le
 * reste d'un achat n'attend que si le budget, une fois les échanges payés, couvre prix × reste ; sinon
 * il est annulé et le manque de fonds signalé. Un achat dit donc toujours son budget (le type l'exige,
 * l'exécution le vérifie encore pour un appelant non typé) : sans lui, rien ne bornerait ce qu'il dépense
 * ni ce qu'il met sous séquestre.
 */
export function planLimitOrder(incoming: PlacedOrder, opposite: readonly HouseOrder[]): OrderPlan {
  if (incoming.side === 'buy' && (incoming.budget as number | undefined) === undefined)
    throw new RangeError('a buy order needs a budget');
  const match = matchLimitOrder(
    incoming,
    opposite.filter((resting) => resting.houseId !== incoming.houseId),
  );
  if (match.remaining === 0) return { ...match, rests: false, escrow: 0 };
  if (incoming.side === 'sell') return { ...match, rests: true, escrow: 0 };
  const spent = match.trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
  const escrow = match.remaining * incoming.price;
  if (!match.shortOfFunds && incoming.budget - spent >= escrow)
    return { ...match, rests: true, escrow };
  return { ...match, shortOfFunds: true, rests: false, escrow: 0 };
}
