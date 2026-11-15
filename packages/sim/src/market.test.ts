import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  matchLimitOrder,
  planLimitOrder,
  type HouseOrder,
  type RestingOrder,
  type Side,
} from './orderbook';
import { accrueProduction } from './production';

describe('production paresseuse', () => {
  const field = { cycleMinutes: 240, outputPerCycle: 40, maxCycles: 36 };
  const t0 = new Date('2026-11-13T00:00:00Z');
  const after = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  it('compte les cycles entiers écoulés et garde le temps entamé du cycle en cours', () => {
    expect(accrueProduction({ ...field, since: t0, now: after(239) })).toEqual({
      cycles: 0,
      quantity: 0,
      since: t0,
    });
    expect(accrueProduction({ ...field, since: t0, now: after(240) })).toEqual({
      cycles: 1,
      quantity: 40,
      since: after(240),
    });
    expect(accrueProduction({ ...field, since: t0, now: after(1000) })).toEqual({
      cycles: 4,
      quantity: 160,
      since: after(960),
    });
  });

  it('à la capacité exacte comme au-delà, le site est plein : rien ne s’accumule en plus, même en deux collectes', () => {
    const cycle = 240;
    for (const minutes of [36 * cycle, 36 * cycle + 239, 37 * cycle, 37 * cycle + 1]) {
      expect(accrueProduction({ ...field, since: t0, now: after(minutes) })).toEqual({
        cycles: 36,
        quantity: 1440,
        since: after(minutes),
      });
    }
    expect(accrueProduction({ ...field, since: t0, now: after(36 * cycle - 1) })).toEqual({
      cycles: 35,
      quantity: 1400,
      since: after(35 * cycle),
    });
    // Collecter juste avant puis juste après le 37e cycle ne rapporte pas plus qu'attendre.
    const first = accrueProduction({ ...field, since: t0, now: after(37 * cycle - 1) });
    const second = accrueProduction({ ...field, since: first.since, now: after(37 * cycle + 1) });
    expect(first.quantity + second.quantity).toBe(1440);
  });

  it('plafonne à la capacité du site : au-delà, la production s’arrête et repart à la collecte', () => {
    const full = accrueProduction({ ...field, since: t0, now: after(240 * 100 + 17) });
    expect(full).toEqual({ cycles: 36, quantity: 1440, since: after(240 * 100 + 17) });
  });

  it('propriété : collecter souvent ou rarement rapporte autant, tant que le site n’est pas plein', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 900 }), { minLength: 1, maxLength: 12 }),
        (gaps) => {
          let [since, now, collected] = [t0, t0, 0];
          for (const gap of gaps) {
            now = new Date(now.getTime() + gap * 60_000);
            const step = accrueProduction({ ...field, since, now });
            since = step.since;
            collected += step.quantity;
          }
          // Sous le plafond seulement : au-delà, collecter souvent évite justement que le site se remplisse.
          fc.pre(now.getTime() - t0.getTime() < field.maxCycles * field.cycleMinutes * 60_000);
          expect(collected).toBe(accrueProduction({ ...field, since: t0, now }).quantity);
        },
      ),
    );
  });

  it('refuse une date invalide, une capacité nulle ou démesurée', () => {
    expect(() => accrueProduction({ ...field, maxCycles: 0, since: t0, now: t0 })).toThrow(
      RangeError,
    );
    expect(() => accrueProduction({ ...field, since: new Date(Number.NaN), now: t0 })).toThrow(
      RangeError,
    );
    expect(() => accrueProduction({ ...field, since: t0, now: new Date(Number.NaN) })).toThrow(
      RangeError,
    );
    expect(() =>
      accrueProduction({
        ...field,
        maxCycles: 2 ** 40,
        outputPerCycle: 2 ** 40,
        since: t0,
        now: t0,
      }),
    ).toThrow(RangeError);
  });

  it('horloge qui recule ou paramètre absurde : rien n’est produit, ou l’appel est refusé', () => {
    expect(accrueProduction({ ...field, since: t0, now: after(-500) }).quantity).toBe(0);
    expect(() => accrueProduction({ ...field, cycleMinutes: 0, since: t0, now: t0 })).toThrow(
      RangeError,
    );
    expect(() => accrueProduction({ ...field, outputPerCycle: 1.5, since: t0, now: t0 })).toThrow(
      RangeError,
    );
  });
});

describe('appariement d’un ordre à cours limité', () => {
  const asks: RestingOrder[] = [
    { orderId: 'a', price: 8, quantity: 10, sequence: 1 },
    { orderId: 'b', price: 7, quantity: 5, sequence: 2 },
    { orderId: 'c', price: 7, quantity: 5, sequence: 3 },
    { orderId: 'd', price: 12, quantity: 50, sequence: 4 },
  ];

  it('achat : meilleur prix d’abord, puis le plus ancien, au prix de l’ordre présent ; le reste va au carnet', () => {
    expect(matchLimitOrder({ side: 'buy', price: 8, quantity: 30 }, asks)).toEqual({
      trades: [
        { restingOrderId: 'b', price: 7, quantity: 5 },
        { restingOrderId: 'c', price: 7, quantity: 5 },
        { restingOrderId: 'a', price: 8, quantity: 10 },
      ],
      remaining: 10,
      shortOfFunds: false,
    });
  });

  it('achat borné par le budget : exécuté pour la part payable, du moins cher au plus cher', () => {
    const buy = (budget: number) =>
      matchLimitOrder({ side: 'buy', price: 8, quantity: 30, budget }, asks);
    // 70 oboles paient les dix unités à 7 ; il ne reste rien pour celles à 8.
    expect(buy(70)).toEqual({
      trades: [
        { restingOrderId: 'b', price: 7, quantity: 5 },
        { restingOrderId: 'c', price: 7, quantity: 5 },
      ],
      remaining: 20,
      shortOfFunds: true,
    });
    // Une unité de plus à 8 se paie avec 78 oboles ; 77 n'y suffisent pas, et rien n'est sauté.
    expect(buy(78).trades.at(-1)).toEqual({ restingOrderId: 'a', price: 8, quantity: 1 });
    expect(buy(77).trades).toHaveLength(2);
    expect(buy(40).trades).toEqual([{ restingOrderId: 'b', price: 7, quantity: 5 }]);
    expect(buy(6)).toEqual({ trades: [], remaining: 30, shortOfFunds: true });
    // Budget suffisant pour tout ce qui croise : le reste tient au carnet, pas à la trésorerie.
    expect(buy(150)).toMatchObject({ remaining: 10, shortOfFunds: false });
    // Sans offre au prix limite, le manque de fonds n'est pas en cause.
    expect(matchLimitOrder({ side: 'buy', price: 6, quantity: 5, budget: 0 }, asks)).toEqual({
      trades: [],
      remaining: 5,
      shortOfFunds: false,
    });
  });

  it('propriété : un achat ne dépense jamais plus que son budget, et ne laisse rien de payable', () => {
    const row = fc.record({
      price: fc.integer({ min: 1, max: 50 }),
      quantity: fc.integer({ min: 1, max: 100 }),
    });
    fc.assert(
      fc.property(
        fc.array(row, { maxLength: 20 }),
        row,
        fc.integer({ min: 0, max: 3000 }),
        (rows, incoming, budget) => {
          const book = rows.map((entry, index) => ({
            ...entry,
            orderId: String(index),
            sequence: index,
          }));
          const free = matchLimitOrder({ side: 'buy', ...incoming }, book);
          const { trades, remaining, shortOfFunds } = matchLimitOrder(
            { side: 'buy', ...incoming, budget },
            book,
          );
          const spent = trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
          const bought = trades.reduce((sum, trade) => sum + trade.quantity, 0);
          expect(spent).toBeLessThanOrEqual(budget);
          expect(bought + remaining).toBe(incoming.quantity);
          // Le budget ne change que la fin : les échanges sont un préfixe de l'appariement sans budget.
          const freeCost = free.trades.reduce(
            (sum, trade) => sum + trade.price * trade.quantity,
            0,
          );
          if (freeCost <= budget) {
            expect({ trades, remaining, shortOfFunds }).toEqual({ ...free, shortOfFunds: false });
          } else {
            expect(shortOfFunds).toBe(true);
            trades.forEach((trade, index) => {
              expect(trade.restingOrderId).toBe(free.trades[index]?.restingOrderId);
              expect(trade.quantity).toBeLessThanOrEqual(free.trades[index]?.quantity ?? 0);
            });
            // L'unité suivante, la moins chère encore offerte, coûte plus que ce qui reste.
            const next = free.trades[trades.length - 1];
            const last = trades.at(-1);
            const nextPrice =
              last && next && last.quantity < next.quantity
                ? next.price
                : free.trades[trades.length]?.price;
            expect(nextPrice).toBeGreaterThan(budget - spent);
          }
        },
      ),
    );
  });

  it('vente : sert les acheteurs les plus offrants ; aucun échange sous le prix limite', () => {
    const bids: RestingOrder[] = [
      { orderId: 'x', price: 5, quantity: 10, sequence: 1 },
      { orderId: 'y', price: 9, quantity: 4, sequence: 2 },
    ];
    expect(matchLimitOrder({ side: 'sell', price: 6, quantity: 10 }, bids)).toEqual({
      trades: [{ restingOrderId: 'y', price: 9, quantity: 4 }],
      remaining: 6,
      shortOfFunds: false,
    });
  });

  it('vente à deux acheteurs croisants : le plus offrant d’abord, puis le plus ancien à prix égal', () => {
    const bids: RestingOrder[] = [
      { orderId: 'bas', price: 7, quantity: 5, sequence: 1 },
      { orderId: 'récent', price: 9, quantity: 5, sequence: 3 },
      { orderId: 'ancien', price: 9, quantity: 5, sequence: 2 },
    ];
    expect(matchLimitOrder({ side: 'sell', price: 7, quantity: 12 }, bids).trades).toEqual([
      { restingOrderId: 'ancien', price: 9, quantity: 5 },
      { restingOrderId: 'récent', price: 9, quantity: 5 },
      { restingOrderId: 'bas', price: 7, quantity: 2 },
    ]);
  });

  it('propriété : identique à un appariement de référence prix-temps, sur des carnets en désordre', () => {
    const resting = fc.record({
      price: fc.integer({ min: 1, max: 20 }),
      quantity: fc.integer({ min: 0, max: 30 }),
    });
    const incoming = fc.record({
      price: fc.integer({ min: 1, max: 20 }),
      quantity: fc.integer({ min: 1, max: 80 }),
    });
    const side = fc.constantFrom('buy' as const, 'sell' as const);
    fc.assert(
      fc.property(
        fc.array(resting, { maxLength: 20 }),
        incoming,
        side,
        fc.array(fc.nat(), { minLength: 20, maxLength: 20 }),
        (rows, order, way, keys) => {
          // Séquences uniques, carnet rangé au hasard : ni par prix ni par ancienneté.
          const book = rows
            .map((row, position) => ({
              ...row,
              orderId: String(position),
              sequence: position,
              key: keys[position] ?? 0,
            }))
            .sort((a, b) => a.key - b.key);
          const crosses = (price: number) =>
            way === 'buy' ? price <= order.price : price >= order.price;
          // Référence : on retire une à une les unités du meilleur ordre restant.
          const left = new Map(book.map((entry) => [entry.orderId, entry.quantity]));
          const expected = new Map<string, number>();
          for (let unit = 0; unit < order.quantity; unit++) {
            const best = book
              .filter((entry) => (left.get(entry.orderId) ?? 0) > 0 && crosses(entry.price))
              .sort(
                (a, b) =>
                  (way === 'buy' ? a.price - b.price : b.price - a.price) ||
                  a.sequence - b.sequence,
              )[0];
            if (!best) break;
            left.set(best.orderId, (left.get(best.orderId) ?? 0) - 1);
            expected.set(best.orderId, (expected.get(best.orderId) ?? 0) + 1);
          }
          const { trades, remaining } = matchLimitOrder({ side: way, ...order }, book);
          expect(new Map(trades.map((trade) => [trade.restingOrderId, trade.quantity]))).toEqual(
            expected,
          );
          expect(trades.every((trade) => trade.quantity > 0)).toBe(true);
          const filled = [...expected.values()].reduce((sum, quantity) => sum + quantity, 0);
          expect(remaining).toBe(order.quantity - filled);
          expect(remaining).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('propriété : quantités conservées, prix toujours au moins aussi bons que la limite, carnet non modifié', () => {
    const order = fc.record({
      price: fc.integer({ min: 1, max: 50 }),
      quantity: fc.integer({ min: 1, max: 100 }),
    });
    fc.assert(
      fc.property(
        fc.array(order, { maxLength: 20 }),
        order,
        fc.constantFrom('buy' as const, 'sell' as const),
        (rows, incoming, side) => {
          const book = rows.map((row, index) => ({
            ...row,
            orderId: String(index),
            sequence: index,
          }));
          const snapshot = structuredClone(book);
          const { trades, remaining } = matchLimitOrder({ side, ...incoming }, book);
          expect(book).toEqual(snapshot);
          expect(trades.reduce((sum, trade) => sum + trade.quantity, 0) + remaining).toBe(
            incoming.quantity,
          );
          for (const trade of trades) {
            const resting = book.find((candidate) => candidate.orderId === trade.restingOrderId);
            expect(trade.quantity).toBeLessThanOrEqual(resting?.quantity ?? 0);
            expect(trade.price).toBe(resting?.price);
            expect(
              side === 'buy' ? trade.price <= incoming.price : trade.price >= incoming.price,
            ).toBe(true);
          }
          // S'il reste de la quantité, plus aucun ordre du carnet ne croise le prix limite.
          if (remaining > 0) {
            const matched = new Set(trades.map((trade) => trade.restingOrderId));
            const leftover = book.filter((resting) => !matched.has(resting.orderId));
            expect(
              leftover.some((resting) =>
                side === 'buy' ? resting.price <= incoming.price : resting.price >= incoming.price,
              ),
            ).toBe(false);
          }
        },
      ),
    );
  });

  it('refuse un budget négatif, non entier, ou donné à une vente', () => {
    const order = { price: 5, quantity: 1 };
    expect(() => matchLimitOrder({ side: 'buy', ...order, budget: -1 }, [])).toThrow(RangeError);
    expect(() => matchLimitOrder({ side: 'buy', ...order, budget: 1.5 }, [])).toThrow(RangeError);
    expect(() => matchLimitOrder({ side: 'sell', ...order, budget: 10 }, [])).toThrow(RangeError);
  });

  it('refuse un prix ou une quantité non entiers ou non positifs', () => {
    expect(() => matchLimitOrder({ side: 'buy', price: 0, quantity: 1 }, [])).toThrow(RangeError);
    expect(() => matchLimitOrder({ side: 'sell', price: 5, quantity: 1.5 }, [])).toThrow(
      RangeError,
    );
  });
});

describe('sort d’un ordre à son arrivée : attente, séquestre, annulation', () => {
  const bids: HouseOrder[] = [
    { orderId: 'mien', houseId: 'a', price: 12, quantity: 5, sequence: 1 },
    { orderId: 'autre', houseId: 'b', price: 9, quantity: 4, sequence: 2 },
  ];

  it('une maison n’échange pas avec elle-même : son propre ordre est ignoré, même mieux placé', () => {
    const sell = { houseId: 'a', side: 'sell' as const, price: 8, quantity: 10 };
    expect(planLimitOrder(sell, bids)).toEqual({
      trades: [{ restingOrderId: 'autre', price: 9, quantity: 4 }],
      remaining: 6,
      shortOfFunds: false,
      rests: true,
      escrow: 0,
    });
  });

  it('achat : le reste attend si le budget couvre prix × reste une fois les échanges payés', () => {
    const asks: HouseOrder[] = [
      { orderId: 'v', houseId: 'b', price: 7, quantity: 10, sequence: 1 },
    ];
    const buy = (budget: number) =>
      planLimitOrder({ houseId: 'a', side: 'buy', price: 8, quantity: 30, budget }, asks);
    // 70 pour les dix unités à 7, puis 20 × 8 = 160 à retenir : 230 suffisent tout juste.
    expect(buy(230)).toMatchObject({
      remaining: 20,
      rests: true,
      escrow: 160,
      shortOfFunds: false,
    });
    expect(buy(229)).toMatchObject({ remaining: 20, rests: false, escrow: 0, shortOfFunds: true });
    expect(buy(229).trades).toEqual([{ restingOrderId: 'v', price: 7, quantity: 10 }]);
    // Rien ne croise : tout attend, ou rien n'est possible.
    expect(buy(0)).toMatchObject({ trades: [], rests: false, shortOfFunds: true });
    expect(
      planLimitOrder({ houseId: 'a', side: 'buy', price: 6, quantity: 5, budget: 30 }, asks),
    ).toEqual({ trades: [], remaining: 5, shortOfFunds: false, rests: true, escrow: 30 });
    // Servi en entier : rien n'attend, rien n'est retenu.
    expect(
      planLimitOrder({ houseId: 'a', side: 'buy', price: 8, quantity: 10, budget: 70 }, asks),
    ).toMatchObject({ remaining: 0, rests: false, escrow: 0, shortOfFunds: false });
  });

  it('un achat sans budget est refusé, qu’il puisse attendre ou non : rien ne bornerait son séquestre', () => {
    const asks: HouseOrder[] = [
      { orderId: 'v', houseId: 'b', price: 7, quantity: 10, sequence: 1 },
    ];
    for (const quantity of [5, 30])
      expect(() => planLimitOrder({ houseId: 'a', side: 'buy', price: 8, quantity }, asks)).toThrow(
        RangeError,
      );
    expect(() =>
      planLimitOrder({ houseId: 'a', side: 'buy', price: 6, quantity: 5 }, asks),
    ).toThrow(RangeError);
    // Une vente, elle, n'a pas de budget.
    expect(planLimitOrder({ houseId: 'a', side: 'sell', price: 9, quantity: 1 }, [])).toMatchObject(
      { rests: true, escrow: 0 },
    );
  });

  it('propriété : un achat ne dépense jamais plus que son budget, et attend dès que le budget restant couvre prix × reste', () => {
    const ask = fc.record({
      houseId: fc.constantFrom('a', 'b', 'c'),
      price: fc.integer({ min: 1, max: 12 }),
      quantity: fc.integer({ min: 1, max: 20 }),
    });
    fc.assert(
      fc.property(
        fc.array(ask, { maxLength: 6 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 0, max: 400 }),
        (asks, price, quantity, budget) => {
          const book = asks.map((entry, index) => ({
            ...entry,
            orderId: String(index),
            sequence: index,
          }));
          const plan = planLimitOrder({ houseId: 'a', side: 'buy', price, quantity, budget }, book);
          const spent = plan.trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
          // Échanges payés et séquestre retenu ne dépassent jamais le budget.
          expect(spent + plan.escrow).toBeLessThanOrEqual(budget);
          // Le reste attend si et seulement si le budget, échanges payés, retient prix × reste.
          expect(plan.rests).toBe(plan.remaining > 0 && budget - spent >= plan.remaining * price);
          expect(plan.escrow).toBe(plan.rests ? plan.remaining * price : 0);
          // Un reste qui n'attend pas est un manque de fonds, signalé.
          if (plan.remaining > 0 && !plan.rests) expect(plan.shortOfFunds).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('propriété : monnaie et biens conservés, séquestre et réservation exacts, aucune auto-transaction, priorité prix puis temps', () => {
    interface Open extends HouseOrder {
      side: Side;
    }
    const houses = ['a', 'b', 'c'];
    const command = fc.oneof(
      fc.record({
        house: fc.constantFrom(...houses),
        side: fc.constantFrom('buy' as const, 'sell' as const),
        price: fc.integer({ min: 1, max: 12 }),
        quantity: fc.integer({ min: 1, max: 40 }),
      }),
      fc.record({ cancel: fc.nat() }),
    );
    fc.assert(
      fc.property(fc.array(command, { maxLength: 40 }), (commands) => {
        const state = new Map(
          houses.map((house) => [house, { balance: 300, escrow: 0, stock: 60, reserved: 0 }]),
        );
        const of = (house: string) => {
          const found = state.get(house);
          if (!found) throw new Error(`unknown house ${house}`);
          return found;
        };
        let book: Open[] = [];
        let sequence = 0;
        for (const step of commands) {
          if ('cancel' in step) {
            const target = book[step.cancel % Math.max(book.length, 1)];
            if (!target) continue;
            book = book.filter((entry) => entry !== target);
            const owner = of(target.houseId);
            if (target.side === 'sell') owner.reserved -= target.quantity;
            else {
              owner.escrow -= target.price * target.quantity;
              owner.balance += target.price * target.quantity;
            }
            continue;
          }
          const mine = of(step.house);
          // Comme la commande : pas de vente au-delà du stock libre.
          if (step.side === 'sell' && mine.stock - mine.reserved < step.quantity) continue;
          const opposite = book.filter((entry) => entry.side !== step.side);
          const plan = planLimitOrder(
            {
              houseId: step.house,
              side: step.side,
              price: step.price,
              quantity: step.quantity,
              ...(step.side === 'buy' ? { budget: mine.balance } : {}),
            },
            opposite,
          );
          // Priorité : le premier ordre servi est le mieux placé des autres maisons, prix puis ancienneté.
          const best = opposite
            .filter(
              (entry) =>
                entry.houseId !== step.house &&
                (step.side === 'buy' ? entry.price <= step.price : entry.price >= step.price),
            )
            .sort(
              (x, y) =>
                (step.side === 'buy' ? x.price - y.price : y.price - x.price) ||
                x.sequence - y.sequence,
            )[0];
          if (plan.trades[0]) expect(plan.trades[0].restingOrderId).toBe(best?.orderId);
          for (const trade of plan.trades) {
            const resting = book.find((entry) => entry.orderId === trade.restingOrderId);
            if (!resting) throw new Error('trade against an order that is not in the book');
            expect(resting.houseId).not.toBe(step.house);
            expect(trade.price).toBe(resting.price);
            const other = of(resting.houseId);
            const amount = trade.price * trade.quantity;
            const [buyer, seller] = step.side === 'buy' ? [mine, other] : [other, mine];
            // L'acheteur qui arrive paie de sa trésorerie ; celui qui attendait, de son séquestre.
            if (step.side === 'buy') buyer.balance -= amount;
            else buyer.escrow -= amount;
            seller.balance += amount;
            seller.stock -= trade.quantity;
            buyer.stock += trade.quantity;
            if (step.side === 'buy') seller.reserved -= trade.quantity;
            resting.quantity -= trade.quantity;
          }
          book = book.filter((entry) => entry.quantity > 0);
          if (plan.rests) {
            book.push({
              orderId: String(sequence),
              houseId: step.house,
              side: step.side,
              price: step.price,
              quantity: plan.remaining,
              sequence: sequence++,
            });
            if (step.side === 'sell') mine.reserved += plan.remaining;
            else {
              expect(plan.escrow).toBe(plan.remaining * step.price);
              mine.balance -= plan.escrow;
              mine.escrow += plan.escrow;
            }
          } else expect(plan.escrow).toBe(0);

          const all = [...state.values()];
          expect(all.reduce((sum, house) => sum + house.balance + house.escrow, 0)).toBe(900);
          expect(all.reduce((sum, house) => sum + house.stock, 0)).toBe(180);
          for (const house of houses) {
            const open = (side: Side) =>
              book.filter((entry) => entry.houseId === house && entry.side === side);
            const { balance, escrow, stock, reserved } = of(house);
            expect(balance).toBeGreaterThanOrEqual(0);
            expect(escrow).toBe(
              open('buy').reduce((sum, entry) => sum + entry.price * entry.quantity, 0),
            );
            expect(reserved).toBe(open('sell').reduce((sum, entry) => sum + entry.quantity, 0));
            expect(reserved).toBeLessThanOrEqual(stock);
          }
        }
      }),
    );
  });
});
