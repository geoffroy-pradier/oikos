import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dailyUpkeep, dailyWages, settleUpkeep, siteDailyDue, sumDailyDues } from './upkeep';

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

  it('hors des entiers sûrs, le calcul est refusé, jamais rendu faux', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(dailyUpkeep(max, 10_000)).toBe(max);
    expect(() => dailyUpkeep(max, 10_001)).toThrow('amount × bps is too large');
    // Produit intermédiaire 9 999 × coefficient : 9 007 199 254 733 526 tient, une unité de plus non.
    expect(dailyUpkeep(9_999, 900_810_006_474)).toBe(900_719_925_474);
    expect(() => dailyUpkeep(9_999, 900_810_006_475)).toThrow('amount × bps is too large');
    // Sans la garde, ce calcul rendait 452 523 346 987 115 : l'exact est 452 523 346 987 116.
    expect(() => dailyUpkeep(9_986, 453_157_767_862_122)).toThrow('amount × bps is too large');
    fc.assert(
      fc.property(base, fc.integer({ min: 0, max: max }), (oboles, bps) => {
        const exact = (BigInt(oboles) * BigInt(bps) + 9_999n) / 10_000n;
        let due: bigint | null = null;
        try {
          due = BigInt(dailyUpkeep(oboles, bps));
        } catch (error) {
          expect(error).toBeInstanceOf(RangeError);
        }
        if (due !== null) expect(due).toBe(exact);
      }),
    );
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

describe('salaires et dû d’un site (4.4, 5.5)', () => {
  const workers = fc.oneof(fc.constantFrom(0, 1, 4), fc.integer({ min: 0, max: 1_000 }));
  const wage = fc.oneof(fc.constantFrom(0, 1), fc.integer({ min: 0, max: 1_000_000_000 }));
  const site = fc.record({
    upkeepBaseOboles: fc.integer({ min: 0, max: 500 }),
    coefficientBps: fc.integer({ min: 0, max: 100_000 }),
    workers: fc.integer({ min: 0, max: 6 }),
    wageOboles: fc.integer({ min: 0, max: 40 }),
  });

  it('exemples : travailleurs × salaire, exact ; aucun travailleur ou un salaire nul ne doivent rien', () => {
    expect(dailyWages(4, 7)).toBe(28);
    expect(dailyWages(0, 7)).toBe(0);
    expect(dailyWages(4, 0)).toBe(0);
    expect(dailyWages(3, 1_000_000_000)).toBe(3_000_000_000);
    // Champ 30 à ×1,25 (37,5 → 38), quatre travailleurs à 7.
    expect(
      siteDailyDue({ upkeepBaseOboles: 30, coefficientBps: 12_500, workers: 4, wageOboles: 7 }),
    ).toEqual({ upkeepOboles: 38, wagesOboles: 28, oboles: 66 });
    // Salaire nul (configuration initiale) : le dû est l'entretien seul, comme avant le personnel.
    expect(
      siteDailyDue({ upkeepBaseOboles: 30, coefficientBps: 12_500, workers: 4, wageOboles: 0 }),
    ).toEqual({ upkeepOboles: 38, wagesOboles: 0, oboles: 38 });
    expect(
      siteDailyDue({ upkeepBaseOboles: 0, coefficientBps: 0, workers: 0, wageOboles: 0 }),
    ).toEqual({ upkeepOboles: 0, wagesOboles: 0, oboles: 0 });
  });

  it('salaires exacts et croissants en travailleurs comme en salaire ; refus hors des entiers sûrs', () => {
    fc.assert(
      fc.property(workers, wage, (count, oboles) => {
        const wages = dailyWages(count, oboles);
        expect(BigInt(wages)).toBe(BigInt(count) * BigInt(oboles));
        expect(dailyWages(count + 1, oboles)).toBeGreaterThanOrEqual(wages);
        expect(dailyWages(count, oboles + 1)).toBeGreaterThanOrEqual(wages);
      }),
    );
    const max = Number.MAX_SAFE_INTEGER;
    expect(dailyWages(1, max)).toBe(max);
    expect(() => dailyWages(2, 2 ** 52)).toThrow('workers × wage is too large');
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 53]) {
      expect(() => dailyWages(bad, 1)).toThrow(RangeError);
      expect(() => dailyWages(1, bad)).toThrow(RangeError);
    }
    // Deux parts sûres dont la somme ne l'est plus : refusé, jamais arrondi.
    expect(() =>
      siteDailyDue({ upkeepBaseOboles: max, coefficientBps: 10_000, workers: 1, wageOboles: 1 }),
    ).toThrow('upkeep + wages is too large');
  });

  it('les parts font le tout : entretien de `dailyUpkeep`, salaires de `dailyWages`', () => {
    fc.assert(
      fc.property(site, (input) => {
        const due = siteDailyDue(input);
        expect(due.upkeepOboles).toBe(dailyUpkeep(input.upkeepBaseOboles, input.coefficientBps));
        expect(due.wagesOboles).toBe(dailyWages(input.workers, input.wageOboles));
        expect(due.oboles).toBe(due.upkeepOboles + due.wagesOboles);
      }),
    );
  });

  it('conservation : ce qui est prélevé est la somme des parts des sites payés, chacun en entier', () => {
    const sites = fc.uniqueArray(fc.record({ siteId: fc.uuid(), input: site }), {
      maxLength: 8,
      selector: (entry) => entry.siteId,
    });
    fc.assert(
      fc.property(balance, sites, (treasury, listed) => {
        const dues = listed.map(({ siteId, input }) => ({ siteId, ...siteDailyDue(input) }));
        const { paid, unpaid, total } = settleUpkeep(treasury, dues);
        const lines = sumDailyDues(paid);
        // Les lignes de l'écriture (une par nature) font exactement le prélèvement.
        expect(lines.oboles).toBe(total);
        expect(lines.upkeepOboles + lines.wagesOboles).toBe(total);
        expect(total).toBeLessThanOrEqual(treasury);
        // Ni paiement partiel, ni part payée seule : un site impayé ne laisse rien dans les lignes.
        expect(sumDailyDues([...paid, ...unpaid]).oboles).toBe(
          dues.reduce((sum, due) => sum + due.oboles, 0),
        );
        for (const due of unpaid) expect(due.oboles).toBeGreaterThan(0);
        // Le règlement rend chaque dû tel quel, ses parts comprises.
        expect([...paid, ...unpaid].sort((a, b) => a.siteId.localeCompare(b.siteId))).toEqual(
          [...dues].sort((a, b) => a.siteId.localeCompare(b.siteId)),
        );
      }),
    );
    expect(sumDailyDues([])).toEqual({ upkeepOboles: 0, wagesOboles: 0, oboles: 0 });
    for (const bad of [-1, 0.5, Number.NaN])
      expect(() => sumDailyDues([{ upkeepOboles: 1, wagesOboles: bad }])).toThrow(RangeError);
  });
});
