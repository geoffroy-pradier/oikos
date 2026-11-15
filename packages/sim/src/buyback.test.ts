import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planBuyback, sameBuybackTotals, type BuybackOrder, type BuybackStock } from './buyback';

const HOUSES = ['house-a', 'house-b', 'house-c'];
const worldOf = (houseId: string) => (houseId === 'house-c' ? 'world-2' : 'world-1');
const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);

const stocks = fc
  .array(fc.record({ houseId: fc.constantFrom(...HOUSES), quantity: fc.nat({ max: 10_000 }) }), {
    maxLength: 8,
  })
  .map((rows) =>
    rows.map((row, index): BuybackStock => ({
      ...row,
      inventoryId: `inv-${index}`,
      worldId: worldOf(row.houseId),
    })),
  );
const orders = fc
  .array(
    fc.record({
      houseId: fc.constantFrom(...HOUSES),
      side: fc.constantFrom('buy' as const, 'sell' as const),
      price: fc.integer({ min: 1, max: 1_000 }),
      remaining: fc.integer({ min: 1, max: 1_000 }),
    }),
    { maxLength: 6 },
  )
  .map((rows) =>
    rows.map((row, index): BuybackOrder => ({
      ...row,
      orderId: `ord-${index}`,
      worldId: worldOf(row.houseId),
      cityId: 'city-1',
    })),
  );
const price = fc.integer({ min: 1, max: 100_000 });

describe('planBuyback', () => {
  it('conservation : la monnaie créée est celle du robinet, les unités retirées celles du stock', () => {
    fc.assert(
      fc.property(price, stocks, orders, (unitPrice, held, open) => {
        const plan = planBuyback(unitPrice, held, open);
        // Ce que chaque trésorerie doit recevoir, recompté depuis les entrées, sans passer par le plan :
        // ses unités au prix de référence, plus prix × reste de ses achats ouverts.
        const owedTo = (houseId: string) =>
          sum(held.filter((s) => s.houseId === houseId).map((s) => s.quantity * unitPrice)) +
          sum(
            open
              .filter((o) => o.houseId === houseId && o.side === 'buy')
              .map((o) => o.price * o.remaining),
          );
        for (const house of plan.houses)
          expect(house.oboles + house.escrowReleasedOboles).toBe(owedTo(house.houseId));
        // Monnaie créée : unités détenues × prix, et rien pour une maison absente du plan.
        expect(plan.totals.oboles).toBe(sum(held.map((s) => s.quantity)) * unitPrice);
        expect(
          sum(HOUSES.filter((h) => !plan.houses.some((p) => p.houseId === h)).map(owedTo)),
        ).toBe(0);
        // Séquestre rendu : exactement prix × reste des achats ouverts, ni plus ni moins.
        const owed = sum(open.filter((o) => o.side === 'buy').map((o) => o.price * o.remaining));
        expect(sum(plan.houses.map((house) => house.escrowReleasedOboles))).toBe(owed);
        // Stock : chaque inventaire non vide part une fois, en entier ; rien de plus.
        const retired = plan.houses.flatMap((house) => house.stocks);
        expect(retired.map((s) => s.inventoryId).sort()).toEqual(
          held
            .filter((s) => s.quantity > 0)
            .map((s) => s.inventoryId)
            .sort(),
        );
        expect(plan.totals.units).toBe(sum(held.map((stock) => stock.quantity)));
      }),
    );
  });

  it('chaque maison est payée de ses unités au prix de référence, une seule fois, dans son monde', () => {
    fc.assert(
      fc.property(price, stocks, orders, (unitPrice, held, open) => {
        const plan = planBuyback(unitPrice, held, open);
        const concerned = new Set([
          ...held.filter((stock) => stock.quantity > 0).map((stock) => stock.houseId),
          ...open.map((order) => order.houseId),
        ]);
        expect(plan.houses.map((house) => house.houseId)).toEqual([...concerned].sort());
        expect(plan.totals.houses).toBe(concerned.size);
        expect(plan.totals.cancelledOrders).toBe(open.length);
        for (const house of plan.houses) {
          expect(house.oboles).toBe(house.units * unitPrice);
          expect(house.worldId).toBe(worldOf(house.houseId));
          expect(house.stocks.every((stock) => stock.houseId === house.houseId)).toBe(true);
          expect(house.stocks.every((stock) => stock.quantity > 0)).toBe(true);
        }
      }),
    );
  });

  it('solde nul : un stock vide ne compte pas ; une maison au seul ordre d’achat est concernée sans rien vendre', () => {
    const plan = planBuyback(
      40,
      [{ inventoryId: 'inv-0', houseId: 'house-a', worldId: 'world-1', quantity: 0 }],
      [
        {
          orderId: 'ord-0',
          houseId: 'house-b',
          worldId: 'world-1',
          cityId: 'city-1',
          side: 'buy',
          price: 8,
          remaining: 5,
        },
      ],
    );
    expect(plan.totals).toEqual({ houses: 1, units: 0, cancelledOrders: 1, oboles: 0 });
    expect(plan.houses).toMatchObject([
      { houseId: 'house-b', units: 0, oboles: 0, escrowReleasedOboles: 40 },
    ]);
    expect(planBuyback(40, [], []).totals).toEqual({
      houses: 0,
      units: 0,
      cancelledOrders: 0,
      oboles: 0,
    });
  });

  it('refuse un prix invalide et tout montant au-delà des entiers sûrs, plutôt que d’arrondir', () => {
    const stock = { inventoryId: 'inv-0', houseId: 'house-a', worldId: 'world-1' };
    expect(() => planBuyback(0, [], [])).toThrow(RangeError);
    expect(() => planBuyback(1.5, [], [])).toThrow(RangeError);
    expect(() => planBuyback(2 ** 30, [{ ...stock, quantity: 2 ** 30 }], [])).toThrow(RangeError);
    const half = Number.MAX_SAFE_INTEGER - 1;
    expect(planBuyback(1, [{ ...stock, quantity: half }], []).totals.oboles).toBe(half);
    expect(() =>
      planBuyback(
        1,
        [
          { ...stock, quantity: half },
          { ...stock, inventoryId: 'inv-1', quantity: 2 },
        ],
        [],
      ),
    ).toThrow(RangeError);
  });

  it('compare les totaux champ par champ', () => {
    const totals = { houses: 2, units: 7, cancelledOrders: 1, oboles: 280 };
    expect(sameBuybackTotals(totals, { ...totals })).toBe(true);
    for (const key of ['houses', 'units', 'cancelledOrders', 'oboles'] as const)
      expect(sameBuybackTotals(totals, { ...totals, [key]: totals[key] + 1 })).toBe(false);
  });
});
