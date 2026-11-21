import { describe, expect, it } from 'vitest';
import { loanAlerts, loanCap, parseHouseHonor, parseMyLoans, parseTempleRules } from './loans';

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

describe('alertes de prêt du tableau de bord (#732)', () => {
  const now = Date.parse('2026-12-01T12:00:00+00:00');
  const at = (days: number) => new Date(now + days * 86_400_000).toISOString();
  const loans = (...rows: object[]) => parseMyLoans(rows.map((extra) => row(extra))) ?? [];

  it('alerte d’une échéance dans les trois jours de jeu, pas au-delà ; la plus proche en tête', () => {
    const alerts = loanAlerts(
      loans(
        { id: 'far', due_at: at(3.01) },
        { id: 'edge', due_at: at(3) },
        { id: 'soon', due_at: at(1) },
      ),
      now,
    );
    expect(alerts.map(({ kind, loan }) => [kind, loan.id])).toEqual([
      ['dueSoon', 'soon'],
      ['dueSoon', 'edge'],
    ]);
  });

  it('une échéance passée que la clôture n’a pas encore prélevée alerte encore', () => {
    expect(loanAlerts(loans({ due_at: at(-0.5) }), now).map(({ kind }) => kind)).toEqual([
      'overdue',
    ]);
  });

  it('un prêt en défaut alerte avant les échéances, quelle que soit son échéance ; un prêt soldé jamais', () => {
    const alerts = loanAlerts(
      loans(
        { id: 'soon', due_at: at(1) },
        { id: 'late', status: 'defaulted', due_at: at(-9) },
        { id: 'paid', status: 'repaid', outstanding: 0, due_at: at(1) },
      ),
      now,
    );
    expect(alerts.map(({ kind, loan }) => [kind, loan.id])).toEqual([
      ['defaulted', 'late'],
      ['dueSoon', 'soon'],
    ]);
  });
});
