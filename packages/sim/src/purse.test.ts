import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { matchNpcDemand, npcGoodBudget } from './demand';
import { applyEntry, buildEntry, moneySupply, type Balances, type LedgerLine } from './ledger';
import { dailyPublicIncome, purseBudget, tickIncome } from './purse';
import { marketTax } from './tax';
import { settleUpkeep, siteDailyDue } from './upkeep';

const klass = fc.record({
  incomePerThousand: fc.integer({ min: 0, max: 10_000 }),
  publicIncomeBps: fc.integer({ min: 0, max: 10_000 }),
  population: fc.oneof(fc.constantFrom(0, 1, 999), fc.integer({ min: 0, max: 100_000_000 })),
});

/** Multiplicateur neutre d'une cité (×1, #657). */
const X1 = 10_000;

describe('revenu public d’un jour d’une cité (#632)', () => {
  it('exemples : revenu d’un jour × part, sommé sur les classes, arrondi une fois à l’obole inférieure', () => {
    // 70 oboles par tick pour 1 000 habitants, 144 ticks, 3 000 habitants : 30 240 par jour, à 100 %.
    const thetes = { incomePerThousand: 70, publicIncomeBps: 10_000, population: 3_000 };
    expect(dailyPublicIncome([thetes], 144, X1)).toBe(30_240);
    // À 2,5 % : 756. Onze classes à 0,099 obole chacune donnent 1, pas 0 : l'arrondi se fait sur la somme.
    expect(dailyPublicIncome([{ ...thetes, publicIncomeBps: 250 }], 144, X1)).toBe(756);
    const tiny = { incomePerThousand: 99, publicIncomeBps: 1, population: 1_000 };
    expect(dailyPublicIncome([tiny], 1, X1)).toBe(0);
    expect(
      dailyPublicIncome([tiny, tiny, tiny, tiny, tiny, tiny, tiny, tiny, tiny, tiny, tiny], 10, X1),
    ).toBe(1);
    // Part nulle, classe vide, aucune classe : rien.
    expect(dailyPublicIncome([{ ...thetes, publicIncomeBps: 0 }], 144, X1)).toBe(0);
    expect(dailyPublicIncome([{ ...thetes, population: 0 }], 144, X1)).toBe(0);
    expect(dailyPublicIncome([], 144, X1)).toBe(0);
  });

  it('propriétés : entier, jamais au-dessus du revenu exact, à moins d’une obole de lui ; croissant en part et en population', () => {
    fc.assert(
      fc.property(
        fc.array(klass, { maxLength: 6 }),
        fc.integer({ min: 1, max: 1_440 }),
        (classes, ticks) => {
          const income = dailyPublicIncome(classes, ticks, X1);
          const exact = classes.reduce(
            (sum, c) =>
              sum +
              BigInt(c.incomePerThousand) *
                BigInt(c.population) *
                BigInt(c.publicIncomeBps) *
                BigInt(ticks),
            0n,
          );
          expect(Number.isSafeInteger(income)).toBe(true);
          expect(BigInt(income) * 10_000_000n <= exact).toBe(true);
          expect(exact - BigInt(income) * 10_000_000n < 10_000_000n).toBe(true);
          const [first, ...rest] = classes;
          if (first) {
            const more = {
              ...first,
              population: first.population + 1,
              publicIncomeBps: first.publicIncomeBps + 1,
            };
            expect(dailyPublicIncome([more, ...rest], ticks, X1)).toBeGreaterThanOrEqual(income);
          }
        },
      ),
    );
  });

  it('refuse un nombre négatif ou fractionnaire', () => {
    const ok = { incomePerThousand: 1, publicIncomeBps: 1, population: 1 };
    for (const bad of [
      { ...ok, population: -1 },
      { ...ok, publicIncomeBps: 0.5 },
      { ...ok, incomePerThousand: Number.NaN },
    ])
      expect(() => dailyPublicIncome([bad], 144, X1)).toThrow(RangeError);
    expect(() => dailyPublicIncome([ok], -1, X1)).toThrow(RangeError);
    for (const city of [-1, 0.5, Number.NaN, Infinity])
      expect(() => dailyPublicIncome([ok], 144, city)).toThrow(RangeError);
  });
});

describe('multiplicateur de la part publique d’une cité (#657)', () => {
  it('exemples : ×1 inchangé, ×0 rien, ×2 le double ; un seul arrondi, après le multiplicateur', () => {
    const thetes = { incomePerThousand: 70, publicIncomeBps: 10_000, population: 3_000 };
    expect(dailyPublicIncome([thetes], 144, 0)).toBe(0);
    expect(dailyPublicIncome([thetes], 144, 20_000)).toBe(60_480);
    // 30 240 × 0,1234 = 3 731,616 : 3 731.
    expect(dailyPublicIncome([thetes], 144, 1_234)).toBe(3_731);
    // 0,999 obole à ×1 : rien ; à ×2, 1,998 : une obole, que deux arrondis (0 × 2) auraient perdue.
    const tiny = { incomePerThousand: 1, publicIncomeBps: 10_000, population: 999 };
    expect(dailyPublicIncome([tiny], 1, X1)).toBe(0);
    expect(dailyPublicIncome([tiny], 1, 20_000)).toBe(1);
  });

  it('propriétés : ⌊exact × multiplicateur⌋, jamais sous deux arrondis successifs ; croissant en multiplicateur', () => {
    const city = fc.oneof(fc.constantFrom(0, 1, 9_999, 10_000, 10_001, 20_000), fc.nat(20_000));
    fc.assert(
      fc.property(
        fc.array(klass, { maxLength: 6 }),
        fc.integer({ min: 1, max: 1_440 }),
        city,
        city,
        (classes, ticks, cityBps, other) => {
          const income = dailyPublicIncome(classes, ticks, cityBps);
          const exact = classes.reduce(
            (sum, c) =>
              sum +
              BigInt(c.incomePerThousand) *
                BigInt(c.population) *
                BigInt(c.publicIncomeBps) *
                BigInt(ticks),
            0n,
          );
          const scaled = exact * BigInt(cityBps);
          // Arrondi unique à l'obole inférieure du produit exact.
          expect(Number.isSafeInteger(income)).toBe(true);
          expect(BigInt(income) * 100_000_000_000n <= scaled).toBe(true);
          expect(scaled - BigInt(income) * 100_000_000_000n < 100_000_000_000n).toBe(true);
          // Deux arrondis (revenu à ×1, puis multiplicateur) ne donnent jamais plus.
          const twice = (BigInt(dailyPublicIncome(classes, ticks, X1)) * BigInt(cityBps)) / 10_000n;
          expect(BigInt(income) >= twice).toBe(true);
          if (cityBps === X1) expect(BigInt(income)).toBe(twice);
          if (other >= cityBps)
            expect(dailyPublicIncome(classes, ticks, other)).toBeGreaterThanOrEqual(income);
        },
      ),
    );
  });
});

describe('budget des PNJ borné par la bourse de leur cité (#632)', () => {
  it('exemples : revenu du tick à l’obole supérieure ; budget inchangé si la bourse le couvre, sinon au prorata', () => {
    expect(tickIncome([{ incomePerThousand: 70, population: 3_001 }])).toBe(211); // 210,07
    expect(tickIncome([{ incomePerThousand: 70, population: 3_000 }])).toBe(210);
    expect(tickIncome([])).toBe(0);
    expect(purseBudget(100, 210, 210)).toBe(100);
    expect(purseBudget(100, 1_000_000, 210)).toBe(100);
    // Bourse de 105 pour un revenu de 210 : la moitié ; 33 × 100 ÷ 210 = 15,7 : 15.
    expect(purseBudget(100, 105, 210)).toBe(50);
    expect(purseBudget(33, 100, 210)).toBe(15);
    // Bourse vide : rien ; revenu nul : rien à réduire.
    expect(purseBudget(100, 0, 210)).toBe(0);
    expect(purseBudget(0, 0, 0)).toBe(0);
    expect(() => purseBudget(-1, 0, 1)).toThrow(RangeError);
    expect(() => tickIncome([{ incomePerThousand: 1.5, population: 1 }])).toThrow(RangeError);
  });

  it('propriété : la même proportion pour chaque bien, et la somme des budgets du panier ne dépasse jamais la bourse', () => {
    const basket = fc.uniqueArray(
      fc.record({
        goodId: fc.constantFrom('wheat', 'bread', 'fish', 'wine'),
        quantityPerThousand: fc.double({ min: 0.01, max: 5, noNaN: true }),
      }),
      { minLength: 1, selector: (entry) => entry.goodId },
    );
    const classes = fc.array(
      fc.record({
        population: fc.integer({ min: 0, max: 1_000_000 }),
        incomePerThousand: fc.integer({ min: 1, max: 500 }),
        basket,
      }),
      { minLength: 1, maxLength: 4 },
    );
    const price = (goodId: string) => ({ wheat: 5, bread: 13, fish: 21, wine: 34 })[goodId] ?? 1;
    fc.assert(
      fc.property(classes, fc.integer({ min: 0, max: 2_000_000 }), (npcClasses, purse) => {
        const income = tickIncome(npcClasses);
        const goods = ['wheat', 'bread', 'fish', 'wine'];
        const budgets = goods.map((goodId) => npcGoodBudget(npcClasses, goodId, price));
        const bounded = budgets.map((budget) => purseBudget(budget, purse, income));
        bounded.forEach((budget, index) => {
          expect(budget).toBeLessThanOrEqual(budgets[index] ?? 0);
          // Même proportion à l'obole près : budget × bourse ÷ revenu, arrondi vers le bas.
          if (purse < income) expect(budget * income <= (budgets[index] ?? 0) * purse).toBe(true);
        });
        if (purse < income)
          expect(bounded.reduce((sum, budget) => sum + budget, 0)).toBeLessThanOrEqual(purse);
      }),
    );
  });
});

describe('boucle monétaire fermée (#632)', () => {
  it('propriété : sans robinet ni puits, la masse monétaire d’un monde reste constante sur N ticks et clôtures', () => {
    // Deux cités, chacune une bourse et un trésor ; trois maisons qui vendent du blé et emploient des travailleurs.
    // Ticks : les PNJ de chaque cité achètent au prorata de leur bourse, le vendeur reçoit le net, le trésor la taxe
    // (aucune part détruite). Clôtures : chaque maison paie ses salaires (sans entretien) à la bourse de la cité de
    // ses sites, en entier ou pas du tout. Ni robinet ni puits : la masse ne bouge pas, aucun solde n'est négatif.
    const world = fc.record({
      purses: fc.tuple(fc.nat(5_000), fc.nat(5_000)),
      houses: fc.array(
        fc.record({
          cash: fc.nat(2_000),
          city: fc.constantFrom(0, 1),
          workers: fc.nat(8),
          price: fc.integer({ min: 1, max: 40 }),
          stock: fc.nat(500),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      population: fc.integer({ min: 0, max: 20_000 }),
      wage: fc.nat(20),
      rateBps: fc.integer({ min: 0, max: 10_000 }),
      steps: fc.array(fc.constantFrom('tick', 'close'), { minLength: 1, maxLength: 40 }),
    });
    fc.assert(
      fc.property(world, ({ purses, houses, population, wage, rateBps, steps }) => {
        const npcClasses = [
          {
            population,
            incomePerThousand: 70,
            basket: [{ goodId: 'wheat', quantityPerThousand: 4 }],
          },
        ];
        let balances: Balances = new Map<string, number>([
          ['purse:0', purses[0]],
          ['purse:1', purses[1]],
          ['treasury:0', 0],
          ['treasury:1', 0],
          ...houses.map((house, index) => [`house:${index}`, house.cash] as const),
        ]);
        const stock = houses.map((house) => house.stock);
        const supply = moneySupply(balances, () => false);
        const post = (lines: LedgerLine[]) => {
          const moving = lines.filter((line) => line.amount !== 0);
          if (moving.length === 0) return;
          const entry = buildEntry('step', moving);
          expect(entry.ok).toBe(true);
          if (!entry.ok) return;
          const next = applyEntry(balances, entry.value, () => false);
          expect(next.ok).toBe(true);
          if (next.ok) balances = next.value;
        };
        for (const step of steps) {
          if (step === 'tick')
            for (const city of [0, 1]) {
              const purse = balances.get(`purse:${city}`) ?? 0;
              const budget = purseBudget(
                npcGoodBudget(npcClasses, 'wheat', () => 5),
                purse,
                tickIncome(npcClasses),
              );
              const sellers = houses.flatMap((house, index) =>
                house.city === city && (stock[index] ?? 0) > 0
                  ? [{ orderId: String(index), price: house.price, quantity: stock[index] ?? 0 }]
                  : [],
              );
              const purchase = matchNpcDemand({
                asks: sellers,
                demandAt: () => (population * 4) / 1_000,
                budget,
                carry: 0,
              });
              for (const fill of purchase.fills) {
                const gross = fill.price * fill.quantity;
                const tax = marketTax(gross, { rateBps, burnShareBps: 0 });
                stock[Number(fill.orderId)] = (stock[Number(fill.orderId)] ?? 0) - fill.quantity;
                post([
                  { accountId: `purse:${city}`, amount: -gross },
                  { accountId: `house:${fill.orderId}`, amount: tax.net },
                  { accountId: `treasury:${city}`, amount: tax.treasury },
                ]);
              }
            }
          else
            houses.forEach((house, index) => {
              const due = siteDailyDue({
                upkeepBaseOboles: 0,
                coefficientBps: 10_000,
                workers: house.workers,
                wageOboles: wage,
              });
              const { paid } = settleUpkeep(balances.get(`house:${index}`) ?? 0, [
                { siteId: 'site', ...due },
              ]);
              const wages = paid.reduce((sum, row) => sum + row.wagesOboles, 0);
              post([
                { accountId: `house:${index}`, amount: -wages },
                { accountId: `purse:${house.city}`, amount: wages },
              ]);
            });
          expect(moneySupply(balances, () => false)).toBe(supply);
          for (const balance of balances.values()) expect(balance).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });
});
