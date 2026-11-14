import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dailyUpkeep, settleUpkeep } from './upkeep';

const base = fc.oneof(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 1_000_000_000 }));
const coefficient = fc.oneof(
  fc.constantFrom(0, 1, 9_999, 10_000, 10_001, 100_000),
  fc.integer({ min: 0, max: 100_000 }),
);
const dues = fc.uniqueArray(
  fc.record({ siteId: fc.uuid(), oboles: fc.integer({ min: 0, max: 500 }) }),
  { maxLength: 8, selector: (due) => due.siteId },
);
const balance = fc.integer({ min: 0, max: 2_000 });

describe('entretien dû par un site', () => {
  it('exemples : ⌈base × coefficient⌉, à l’obole supérieure', () => {
    expect(dailyUpkeep(30, 10_000)).toBe(30);
    expect(dailyUpkeep(30, 12_500)).toBe(38); // 37,5
    expect(dailyUpkeep(45, 8_000)).toBe(36);
    expect(dailyUpkeep(35, 1)).toBe(1); // 0,0035
    expect(dailyUpkeep(60, 100_000)).toBe(600);
    expect(dailyUpkeep(0, 100_000)).toBe(0);
    expect(dailyUpkeep(60, 0)).toBe(0);
    expect(dailyUpkeep(1_000_000_000, 99_999)).toBe(9_999_900_000);
  });

  it('arrondi exact à l’obole supérieure ; coefficient ×1 : la base ; jamais décroissant', () => {
    fc.assert(
      fc.property(base, coefficient, (oboles, bps) => {
        const due = BigInt(dailyUpkeep(oboles, bps));
        const exact = BigInt(oboles) * BigInt(bps);
        expect(due * 10_000n >= exact && (due - 1n) * 10_000n < exact).toBe(true);
        expect(dailyUpkeep(oboles, 10_000)).toBe(oboles);
        if (bps < 100_000) expect(dailyUpkeep(oboles, bps + 1)).toBeGreaterThanOrEqual(Number(due));
      }),
    );
  });

  it('refuse une base ou un coefficient qui ne sont pas des entiers dans les bornes', () => {
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 53]) expect(() => dailyUpkeep(bad, 1)).toThrow();
    for (const bad of [-1, 0.5, Number.NaN, 2 ** 53]) expect(() => dailyUpkeep(1, bad)).toThrow();
  });

  it('refuse un entretien qui sortirait des entiers sûrs, sans rendre un montant faux', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(dailyUpkeep(max, 10_000)).toBe(max);
    expect(() => dailyUpkeep(max, 10_001)).toThrow('Upkeep is too large');
    expect(() => dailyUpkeep(max, 100_000)).toThrow('Upkeep is too large');
  });
});

describe('règlement de l’entretien d’une maison', () => {
  const [a, b, c] = [
    { siteId: 'a', oboles: 30 },
    { siteId: 'b', oboles: 60 },
    { siteId: 'c', oboles: 45 },
  ];

  it('exemples : tout, rien, et le site trop cher sauté sans arrêter les suivants', () => {
    expect(settleUpkeep(135, [a, b, c])).toEqual({ paid: [a, b, c], unpaid: [], total: 135 });
    expect(settleUpkeep(134, [a, b, c])).toEqual({ paid: [a, b], unpaid: [c], total: 90 });
    // 80 : a payé (reste 50), b trop cher (60), c payé (reste 5).
    expect(settleUpkeep(80, [a, b, c])).toEqual({ paid: [a, c], unpaid: [b], total: 75 });
    // L'ordre décide : le même solde paie b seul quand b passe d'abord.
    expect(settleUpkeep(80, [b, a, c])).toEqual({ paid: [b], unpaid: [a, c], total: 60 });
    expect(settleUpkeep(29, [a, b, c])).toEqual({ paid: [], unpaid: [a, b, c], total: 0 });
    expect(settleUpkeep(0, [])).toEqual({ paid: [], unpaid: [], total: 0 });
  });

  it('un entretien nul est toujours réglé, même sans trésorerie', () => {
    const free = { siteId: 'free', oboles: 0 };
    expect(settleUpkeep(0, [a, free])).toEqual({ paid: [free], unpaid: [a], total: 0 });
  });

  it('jamais de solde négatif ni de paiement partiel : chaque site est payé en entier ou pas du tout', () => {
    fc.assert(
      fc.property(balance, dues, (treasury, sites) => {
        const { paid, unpaid, total } = settleUpkeep(treasury, sites);
        expect(total).toBe(paid.reduce((sum, due) => sum + due.oboles, 0));
        expect(total).toBeLessThanOrEqual(treasury);
        // Partition qui garde l'ordre : chaque site d'un côté et d'un seul, tel qu'il a été reçu.
        expect(paid.length + unpaid.length).toBe(sites.length);
        const settled = new Set(paid);
        expect(sites.filter((due) => settled.has(due))).toEqual(paid);
        expect(sites.filter((due) => !settled.has(due))).toEqual(unpaid);
      }),
    );
  });

  it('un site n’est impayé que si le reste de la trésorerie, à son tour, ne le couvrait pas', () => {
    fc.assert(
      fc.property(balance, dues, (treasury, sites) => {
        const settled = new Set(settleUpkeep(treasury, sites).paid);
        let left = treasury;
        for (const due of sites) {
          expect(settled.has(due)).toBe(due.oboles <= left);
          if (settled.has(due)) left -= due.oboles;
        }
      }),
    );
  });

  it('une trésorerie qui couvre tout paie tout ; refuse un solde ou un dû négatifs ou fractionnaires', () => {
    fc.assert(
      fc.property(dues, balance, (sites, extra) => {
        const all = sites.reduce((sum, due) => sum + due.oboles, 0);
        expect(settleUpkeep(all + extra, sites)).toEqual({ paid: sites, unpaid: [], total: all });
      }),
    );
    expect(() => settleUpkeep(1_000, [a, b, { ...a }])).toThrow('each site is settled once');
    for (const bad of [-1, 0.5, Number.NaN]) {
      expect(() => settleUpkeep(bad, [])).toThrow(RangeError);
      expect(() => settleUpkeep(10, [{ siteId: 'a', oboles: bad }])).toThrow(RangeError);
    }
  });
});
