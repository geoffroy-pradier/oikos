// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Écran Comptes (#694) : bilan en cartes, stocks valorisés en tableau ; lectures simulées, vue par vue.
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
  useClockRules: () => ({ rules: null, failed: false, reload: () => Promise.resolve() }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useRouterState: () => '/comptes',
}));
const { AccountsScreen } = await import('./Accounts');

async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
      >
        <AccountsScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const stock = (good: string, quantity: number, price: number | null) => ({
  city_id: 'c1',
  good_id: good,
  quantity,
  unit_price: price,
  value: price === null ? null : price * quantity,
  priced_at: price === null ? null : '2026-11-19T10:00:00Z',
});
afterEach(() => {
  cleanup();
  state.views = {};
});

describe('écran Comptes (#694)', () => {
  it('le bilan en cartes, total compris ; les stocks sans prix, dits tels, en fin de tableau', async () => {
    state.views = {
      my_balance_sheet: [{ treasury: 3000, escrow: 60, stock_value: 280, unpriced_stocks: 1 }],
      my_valued_stocks: [stock('clay', 5, null), stock('wheat', 40, 7), stock('olives', 10, 30)],
    };
    await show();
    const sheet = within(screen.getByRole('region', { name: fr.accounts.balanceSheet }));
    expect(sheet.getAllByRole('listitem').map((card) => card.textContent)).toEqual([
      'Trésorerie500 drachmes',
      'Séquestre (retenu pour vos achats en attente)10 drachmes',
      "Stocks, au prix moyen observé46 drachmes 4 oboles1 stock sans prix observé n'est pas compté.",
      'Total556 drachmes 4 oboles',
    ]);
    // Tableau des stocks : de la plus forte valeur à la plus faible, le stock sans prix à la fin.
    const table = within(screen.getByRole('table', { name: fr.accounts.stocks }));
    expect(table.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Olives',
      'Blé',
      'Argile',
    ]);
    const clay = within(table.getByRole('row', { name: /^Argile/ }));
    expect(clay.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '5',
      fr.accounts.noPrice,
      fr.accounts.notValued,
    ]);
  });

  it('compte de résultat en tableau : la journée la plus récente d’abord, à sa date civile', async () => {
    const day = (gameDay: number, grants: number) => ({
      game_day: gameDay,
      ...{ sales: 0, purchases: 0, taxes: 0, upkeep: 0, operating_result: 0 },
      ...{ acquisitions: 0, grants, other: 0, non_operating: grants },
      ...{ cash_change: grants, escrow_change: 0 },
    });
    state.views = {
      my_balance_sheet: [{ treasury: 3000, escrow: 0, stock_value: 0, unpriced_stocks: 0 }],
      my_income_statement: [day(20_772, 6), day(20_773, 3000)],
    };
    await show();
    const table = within(screen.getByRole('table', { name: fr.accounts.income.title }));
    expect(table.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      '16 nov. 2026',
      '15 nov. 2026',
    ]);
    const latest = within(table.getByRole('row', { name: /^16 nov/ })).getAllByRole('cell');
    expect(latest).toHaveLength(11);
    expect(latest[6]?.textContent).toBe('500 drachmes');
  });

  it('bilan illisible : annoncé et réessayé, jamais montré comme un bilan nul', async () => {
    state.views = { my_balance_sheet: [] };
    await show();
    expect(screen.getByRole('alert').textContent).toBe(fr.app.loadFailed);
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
    expect(screen.queryByRole('region', { name: fr.accounts.balanceSheet })).toBeNull();
  });
});
