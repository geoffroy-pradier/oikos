import { describe, expect, it } from 'vitest';
import { loanCap, parseHouseHonor, parseMyLoans, parseTempleRules } from './loans';

const row = (extra = {}) => ({
  id: 'l1',
  lender: 'temple',
  principal: 6000,
  rate_bps: 1000,
  term_days: 30,
  interest: 50,
  due_day: 20_400,
  due_at: '2026-12-21T04:00:00+00:00',
  principal_repaid: 0,
  interest_repaid: 0,
  outstanding: 6050,
  status: 'active',
  ...extra,
});

describe('prêts de la maison (#732)', () => {
  it('lit les prêts non soldés, le plus proche de son échéance d’abord, sans montrer un prêt remboursé', () => {
    const loans = parseMyLoans([
      row({ id: 'late', due_at: '2026-12-30T04:00:00+00:00' }),
      row({
        id: 'repaid',
        status: 'repaid',
        outstanding: 0,
        principal_repaid: 6000,
        interest_repaid: 50,
      }),
      row({ id: 'soon', due_at: '2026-12-01T04:00:00+00:00', status: 'defaulted' }),
    ]);
    expect(loans?.map((loan) => loan.id)).toEqual(['soon', 'late']);
    expect(loans?.[0]).toMatchObject({ status: 'defaulted', outstanding: 6050, rateBps: 1000 });
  });

  it('les intérêts restants sont les intérêts moins ce qui en est payé, au plus le reste dû', () => {
    const [partial, tail] =
      parseMyLoans([
        row({ interest_repaid: 20, principal_repaid: 0, outstanding: 6030 }),
        row({
          id: 'l2',
          interest: 50,
          interest_repaid: 10,
          principal_repaid: 6000,
          outstanding: 40,
        }),
      ]) ?? [];
    expect(partial?.interestDue).toBe(30);
    expect(tail?.interestDue).toBe(40);
  });

  it('refuse une ligne illisible plutôt que de la prendre pour une absence de dette', () => {
    expect(parseMyLoans([row({ outstanding: 'beaucoup' })])).toBeNull();
    expect(parseMyLoans([row({ due_at: 'demain' })])).toBeNull();
    expect(parseMyLoans([])).toEqual([]);
  });

  it('lit la Timè et la marque de la maison ; sans ligne, une Timè nulle sans marque', () => {
    expect(
      parseHouseHonor([{ honor: 12, dishonored: true, dishonored_until_day: 20_430 }]),
    ).toEqual({ honor: 12, dishonor: { dishonored: true, untilDay: 20_430 } });
    expect(parseHouseHonor([])).toEqual({
      honor: 0,
      dishonor: { dishonored: false, untilDay: null },
    });
    expect(parseHouseHonor([{ honor: 'x' }])).toBeNull();
  });

  it('lit les règles du temple ; sans ligne le temple est fermé ; une ligne illisible est une panne', () => {
    const rules = parseTempleRules([
      {
        policy_rate_bps: 800,
        term_days: [30, 7],
        principal_caps: [
          { minHonor: 0, maxPrincipal: 600 },
          { minHonor: 50, maxPrincipal: 9000 },
        ],
      },
    ]);
    expect(rules).toMatchObject({ policyRateBps: 800, termDays: [7, 30] });
    expect(parseTempleRules([])).toBe('closed');
    expect(parseTempleRules([{ policy_rate_bps: 'x' }])).toBeNull();
    expect(parseTempleRules(null)).toBeNull();
  });

  it('le plafond suit la Timè par la formule de packages/sim : zéro sous le premier palier', () => {
    const rules = parseTempleRules([
      {
        policy_rate_bps: 800,
        term_days: [7],
        principal_caps: [
          { minHonor: 10, maxPrincipal: 600 },
          { minHonor: 50, maxPrincipal: 9000 },
        ],
      },
    ]);
    if (rules === null || rules === 'closed') throw new Error('rules expected');
    expect([5, 10, 49, 50, 500].map((honor) => loanCap(honor, rules))).toEqual([
      0, 600, 600, 9000, 9000,
    ]);
  });
});
