/**
 * Rachat du stock d'un bien à retirer (docs/specs/05-economie.md, 5.1) : fonction pure, sans entrée-sortie.
 * Tous les ordres ouverts du bien sont annulés, puis tout son stock, libre une fois les ventes annulées,
 * est racheté au prix de référence. Quantités et montants en entiers ; aucun arrondi.
 */

export interface BuybackStock {
  inventoryId: string;
  houseId: string;
  worldId: string;
  quantity: number;
}

export interface BuybackOrder {
  orderId: string;
  houseId: string;
  worldId: string;
  cityId: string;
  side: 'buy' | 'sell';
  price: number;
  remaining: number;
}

export interface HouseBuyback {
  houseId: string;
  worldId: string;
  /** Unités rachetées, toutes cités confondues. */
  units: number;
  /** Monnaie créée pour la maison : unités × prix de référence. */
  oboles: number;
  /** Ordres ouverts annulés, des deux côtés. */
  cancelledOrders: number;
  /** Séquestre rendu à la trésorerie : prix × reste de ses achats ouverts. */
  escrowReleasedOboles: number;
  stocks: BuybackStock[];
  orders: BuybackOrder[];
}

export interface BuybackTotals {
  houses: number;
  units: number;
  cancelledOrders: number;
  oboles: number;
}

export interface BuybackPlan {
  houses: HouseBuyback[];
  totals: BuybackTotals;
}

const safe = (value: number) => {
  if (!Number.isSafeInteger(value))
    throw new RangeError('Buyback amount out of safe integer range');
  return value;
};

/**
 * Répartit le rachat par maison, dans l'ordre des identifiants. Une maison concernée détient du bien ou
 * porte un ordre ouvert dessus ; un stock vide ne compte pas. Lève `RangeError` si un montant dépasse les
 * entiers sûrs : rien n'est alors écrit.
 */
export function planBuyback(
  unitPrice: number,
  stocks: readonly BuybackStock[],
  orders: readonly BuybackOrder[],
): BuybackPlan {
  if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0)
    throw new RangeError('Invalid unit price');
  const byHouse = new Map<string, HouseBuyback>();
  const houseOf = ({ houseId, worldId }: { houseId: string; worldId: string }) => {
    let house = byHouse.get(houseId);
    if (!house) {
      house = {
        houseId,
        worldId,
        units: 0,
        oboles: 0,
        cancelledOrders: 0,
        escrowReleasedOboles: 0,
        stocks: [],
        orders: [],
      };
      byHouse.set(houseId, house);
    }
    return house;
  };
  for (const stock of stocks) {
    if (stock.quantity <= 0) continue;
    const house = houseOf(stock);
    house.units = safe(house.units + stock.quantity);
    house.stocks.push(stock);
  }
  for (const order of orders) {
    const house = houseOf(order);
    if (order.side === 'buy')
      house.escrowReleasedOboles = safe(
        house.escrowReleasedOboles + safe(order.price * order.remaining),
      );
    house.orders.push(order);
    house.cancelledOrders = house.orders.length;
  }
  const houses = [...byHouse.values()].sort((a, b) =>
    a.houseId < b.houseId ? -1 : a.houseId > b.houseId ? 1 : 0,
  );
  const totals: BuybackTotals = { houses: houses.length, units: 0, cancelledOrders: 0, oboles: 0 };
  for (const house of houses) {
    house.oboles = safe(house.units * unitPrice);
    totals.units = safe(totals.units + house.units);
    totals.oboles = safe(totals.oboles + house.oboles);
    totals.cancelledOrders += house.cancelledOrders;
  }
  return { houses, totals };
}

/** Vrai si les totaux sont ceux qu'Olympe a montrés : sinon l'état a changé, rien n'est racheté. */
export const sameBuybackTotals = (a: BuybackTotals, b: BuybackTotals) =>
  a.houses === b.houses &&
  a.units === b.units &&
  a.cancelledOrders === b.cancelledOrders &&
  a.oboles === b.oboles;
