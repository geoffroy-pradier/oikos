// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

// Écran Finances (#732) : lectures simulées vue par vue.
const state = vi.hoisted(() => ({
  views: {} as Record<string, unknown[] | null>,
  reads: [] as [string, unknown][],
  loading: new Set<string>(),
}));
const api = vi.hoisted(() => ({ repayLoan: vi.fn(), borrowFromTemple: vi.fn() }));
vi.mock('../api', () => ({
  repayLoan: api.repayLoan,
  borrowFromTemple: api.borrowFromTemple,
}));
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, _order: string, filters?: unknown) => {
    state.reads.push([view, filters]);
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    if (state.loading.has(view))
      return { rows: null, failed: false, reload: () => Promise.resolve(null) };
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
  useClockRules: () => ({ rules: null }),
}));
vi.mock('../HouseNav', () => ({ HouseNav: () => null }));
const { FinancesScreen } = await import('./Finances');

const loan = (extra = {}) => ({
  id: 'l1',
  lender: 'temple',
  principal: 6000,
  rate_bps: 1000,
  term_days: 30,
  interest: 50,
  due_day: 20_400,
  due_at: '2999-01-01T04:00:00+00:00',
  principal_repaid: 0,
  interest_repaid: 20,
  outstanding: 6030,
  status: 'active',
  ...extra,
});
const RULES = {
  policy_rate_bps: 1000,
  term_days: [7, 30],
  principal_caps: [
    { minHonor: 0, maxPrincipal: 600 },
    { minHonor: 50, maxPrincipal: 9000 },
  ],
};
const plain = (node: HTMLElement | null) => node?.textContent?.replace(/\p{Zs}/gu, ' ');

async function show(lng: 'fr' | 'en' = 'fr') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  const house = {
    id: 'h1',
    name: 'Test',
    cityId: 'c1',
    accessToken: 'jeton',
    cityName: 'Kallistè',
  };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'citizen' }}
      >
        <FinancesScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  api.repayLoan.mockReset();
  api.borrowFromTemple.mockReset();
  state.reads = [];
  state.loading.clear();
  state.views = {
    temple_treasury_rules: [RULES],
    my_balance_sheet: [{ treasury: 1000, escrow: 0, stock_value: 0, unpriced_stocks: 0 }],
    my_loans: [loan()],
    house_honor: [{ honor: 10, dishonored: false, dishonored_until_day: null }],
  };
});
afterEach(cleanup);

describe('écran Finances, dettes (#732)', () => {
  it('montre le prêteur, le reste dû en drachmes et oboles, l’échéance et les intérêts restants', async () => {
    await show();
    const card = within(document.querySelector('[data-loan="l1"]') as HTMLElement);
    expect(card.getByRole('heading', { name: 'Trésor du temple' })).toBeTruthy();
    expect(plain(card.getByText('Reste dû', { selector: 'dt' }).closest('div'))).toContain(
      '1 005 drachmes',
    );
    expect(card.getByText('Échéance', { selector: 'dt' })).toBeTruthy();
    expect(plain(card.getByText('Intérêts', { selector: 'dt' }).closest('div'))).toContain(
      '5 drachmes',
    );
    expect(plain(card.getByText(/^restants sur /))).toContain(
      "restants sur 8 drachmes 2 oboles, à 10 % l'an",
    );
    expect(card.getByText('En cours')).toBeTruthy();
    expect(screen.queryByText('Marque de déshonneur')).toBeNull();
  });

  it('un prêt échu pas encore prélevé le dit ; un prêt en défaut aussi', async () => {
    state.views['my_loans'] = [
      loan({ id: 'a', due_at: '2020-01-01T04:00:00+00:00' }),
      loan({ id: 'b', due_at: '2020-01-02T04:00:00+00:00', status: 'defaulted' }),
    ];
    await show();
    expect(
      within(document.querySelector('[data-loan="a"]') as HTMLElement).getByText('Échu'),
    ).toBeTruthy();
    expect(
      within(document.querySelector('[data-loan="b"]') as HTMLElement).getByText('En défaut'),
    ).toBeTruthy();
  });

  it('marque de déshonneur : tant qu’un prêt est en défaut, puis jusqu’à son dernier jour', async () => {
    state.views['house_honor'] = [{ honor: 0, dishonored: true, dishonored_until_day: null }];
    state.views['my_loans'] = [loan({ status: 'defaulted' })];
    const view = await show();
    expect(screen.getByRole('heading', { name: 'Marque de déshonneur' })).toBeTruthy();
    expect(screen.getByText(/tant qu'il n'est pas soldé/)).toBeTruthy();
    view.unmount();

    state.views['house_honor'] = [{ honor: 0, dishonored: true, dishonored_until_day: 20_500 }];
    state.views['my_loans'] = [];
    await show();
    const until = new Intl.DateTimeFormat('fr', { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(20_500 * 86_400_000),
    );
    expect(plain(screen.getByText(/^Votre maison porte une marque/))).toContain(
      `jusqu'au ${until.replace(/\p{Zs}/gu, ' ')}`,
    );
  });

  it('sans dette : le dit ; lecture en échec : le dit et propose de relire, jamais « aucune dette »', async () => {
    state.views['my_loans'] = [];
    const view = await show();
    expect(screen.getByText('Aucune dette en cours.')).toBeTruthy();
    view.unmount();

    state.views['my_loans'] = null;
    await show();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
    expect(screen.queryByText('Aucune dette en cours.')).toBeNull();
  });

  it('une ligne illisible est une panne, pas une absence de dette', async () => {
    state.views['my_loans'] = [loan({ outstanding: 'x' })];
    await show();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
    expect(screen.queryByText('Aucune dette en cours.')).toBeNull();
  });

  it('en anglais : prêteur, états et unités', async () => {
    await show('en');
    expect(screen.getByRole('heading', { level: 3, name: 'Temple Treasury' })).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(plain(screen.getByText('Still owed', { selector: 'dt' }).closest('div'))).toContain(
      '1,005 drachmas',
    );
  });

  it('« Rembourser » ouvre la feuille, bornée par la trésorerie lue, et annonce le remboursement', async () => {
    api.repayLoan.mockResolvedValue({
      ok: true,
      replayed: false,
      data: { loanId: 'l1', interest: 30, principal: 270, outstanding: 5730, status: 'active' },
    });
    await show();
    fireEvent.click(screen.getByRole('button', { name: /^Rembourser\p{Zs}: Trésor du temple$/u }));
    const sheet = within(screen.getByRole('dialog', { name: 'Rembourser un prêt' }));
    expect(plain(sheet.getByText(/^De 1 à /))).toContain('De 1 à 1 000 oboles');
    fireEvent.change(sheet.getByLabelText(/^Montant remboursé/), { target: { value: '300' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Continuer' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Rembourser 50 drachmes' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/^Remboursement de /),
    );
    expect(plain(screen.getByRole('status'))).toContain('il reste 955 drachmes à devoir');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('trésorerie illisible : le montant n’est borné que par le reste dû, l’API tranche', async () => {
    state.views['my_balance_sheet'] = [{ treasury: 'x' }];
    await show();
    fireEvent.click(screen.getByRole('button', { name: /^Rembourser\p{Zs}: Trésor du temple$/u }));
    expect(plain(screen.getByText(/^De 1 à /))).toContain('De 1 à 6 030 oboles');
  });

  it('Trésor du temple : taux directeur, Timè et plafond du palier atteint, et « Emprunter » ouvre la feuille', async () => {
    await show();
    const card = within(
      screen
        .getByRole('heading', { level: 2, name: 'Trésor du temple' })
        .closest('section') as HTMLElement,
    );
    expect(plain(card.getByText('Taux directeur', { selector: 'dt' }).closest('div'))).toContain(
      "10 % l'an",
    );
    expect(
      plain(card.getByText('Plafond de votre Timè', { selector: 'dt' }).closest('div')),
    ).toContain('100 drachmes');
    cleanup();
    state.views['my_loans'] = [];
    state.views['house_honor'] = [{ honor: 60, dishonored: false, dishonored_until_day: null }];
    await show();
    expect(
      plain(screen.getByText('Plafond de votre Timè', { selector: 'dt' }).closest('div')),
    ).toContain('1 500 drachmes');
    fireEvent.click(screen.getByRole('button', { name: 'Emprunter' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Emprunter au Trésor du temple' }));
    expect(plain(sheet.getByText(/^De 1 à /))).toContain('De 1 à 9 000 oboles');
  });

  it('emprunter annonce le prêt accordé et relit ; le plafond est celui de la Timè lue', async () => {
    state.views['my_loans'] = [];
    api.borrowFromTemple.mockResolvedValue({
      ok: true,
      replayed: false,
      data: {
        loanId: 'l9',
        principal: 600,
        rateBps: 1000,
        termDays: 7,
        interest: 2,
        outstanding: 602,
        dueDay: 1,
        dueAt: '2999-01-01T04:00:00+00:00',
      },
    });
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Emprunter' }));
    const sheet = within(screen.getByRole('dialog'));
    fireEvent.change(sheet.getByLabelText(/^Montant emprunté/), { target: { value: '600' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Continuer' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Continuer' }));
    fireEvent.click(sheet.getByRole('button', { name: /^Emprunter / }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Prêt accordé/));
    expect(api.borrowFromTemple.mock.calls[0]?.[0]).toEqual({
      principal: 600,
      termDays: 7,
      expectedRateBps: 1000,
    });
  });

  it.each([
    ['temple_treasury_rules', [], /ne prête pas pour l'instant/],
    [
      'house_honor',
      [{ honor: 70, dishonored: true, dishonored_until_day: null }],
      /ne peut pas emprunter/,
    ],
    [
      'house_honor',
      [{ honor: -5, dishonored: false, dishonored_until_day: null }],
      /n'atteint pas le premier palier/,
    ],
    ['my_loans', [loan()], /remboursez-le pour emprunter de nouveau/],
  ])('pas d’emprunt possible (%s) : le dit, sans bouton', async (view, rows, reason) => {
    state.views['my_loans'] = [];
    state.views[view] = rows as unknown[];
    await show();
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Emprunter' })).toBeNull();
  });

  it('règles du temple illisibles : relire dans la carte, les dettes restent montrées', async () => {
    state.views['temple_treasury_rules'] = null;
    await show();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
    expect(screen.getByText('Reste dû', { selector: 'dt' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Emprunter' })).toBeNull();
    expect(screen.queryByText(/n'atteint pas le premier palier/)).toBeNull();
  });

  it('règles du temple en cours de chargement : ni blocage ni plafond affirmés', async () => {
    state.loading.add('temple_treasury_rules');
    state.views['my_loans'] = [];
    await show();
    expect(screen.queryByText(/n'atteint pas le premier palier/)).toBeNull();
    expect(screen.queryByText(/ne prête pas pour l'instant/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Emprunter' })).toBeNull();
  });

  it('ne lit que sa propre maison : chaque lecture de prêt, de Timè ou de trésorerie porte son identifiant', async () => {
    await show();
    const own = state.reads.filter(([view]) =>
      ['my_loans', 'house_honor', 'my_balance_sheet'].includes(view),
    );
    expect(new Set(own.map(([view]) => view)).size).toBe(3);
    for (const [, filters] of own) expect(filters).toEqual({ house_id: 'h1' });
  });
});
