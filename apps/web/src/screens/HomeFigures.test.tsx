// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomeRow } from '../accounts';
import fr from '../locales/fr.json';
import { HomeFigures } from './HomeFigures';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/agora">{children}</a>,
}));

// Une semaine : dotation il y a dix jours, +12 oboles hier ; aujourd'hui, 48 de ventes et 30 de charges.
const history = Array.from({ length: 14 }, (_, i) => ({
  day: 100 + i,
  balance: i < 12 ? 588 : 600,
  net: i === 12 ? 12 : 0,
}));
const today = { sales: 48, purchases: 0, taxes: 0, upkeep: -30, operating_result: 18 } as IncomeRow;
const sheet = { treasury: 600, escrow: 0, stockValue: 240, unpricedStocks: 2, total: 840 };

async function show(props: Partial<Parameters<typeof HomeFigures>[0]> = {}) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({ resources: { fr: { translation: fr } }, lng: 'fr' });
  render(
    <I18nextProvider i18n={instance}>
      <HomeFigures
        figures={{ history, today, sheet, failed: false, reload: vi.fn() }}
        balance={600}
        held={30}
        orders={{ buys: 1, sells: 0 }}
        sites={{ running: 1, total: 2, workers: 4, posted: 1 }}
        {...props}
      />
    </I18nextProvider>,
  );
}
afterEach(cleanup);

describe('chiffres clés du tableau de bord', () => {
  it('trésorerie, sa variation sur 7 jours par la forme, le séquestre et l’agora ; trois autres cartes', async () => {
    await show();
    expect(screen.getByRole('region', { name: fr.home.figures.title })).toBeTruthy();
    expect(screen.getByText('100 drachmes')).toBeTruthy();
    expect(screen.getByText('+2 drachmes').parentElement?.textContent).toBe(
      '▲ +2 drachmes sur 7 jours',
    );
    expect(screen.getByText(/^plus 5 drachmes au séquestre/)).toBeTruthy();
    expect(screen.getByText(/^Ordres ouverts à l'agora : 1 achat, 0 vente\./)).toBeTruthy();
    const card = (label: string) => screen.getByText(label).closest('section')?.textContent;
    expect(card(fr.home.figures.today)).toContain(
      '+3 drachmesVentes 8 drachmes · charges 5 drachmes',
    );
    expect(card(fr.home.figures.stocks)).toContain('40 drachmes2 stocks sans prix observé');
    expect(card(fr.home.figures.sites)).toContain('1 / 24 travailleurs · 1 intendant');
  });

  it('rien de lu : des tirets, jamais un zéro inventé ; aucun mouvement aujourd’hui : un résultat nul', async () => {
    await show({
      figures: {
        history: null,
        today: undefined,
        sheet: undefined,
        failed: false,
        reload: vi.fn(),
      },
      balance: undefined,
      orders: null,
      sites: null,
    });
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/sur 7 jours/)).toBeNull();
    cleanup();
    await show({ figures: { history, today: null, sheet, failed: false, reload: vi.fn() } });
    expect(screen.getByText(fr.home.figures.today).closest('section')?.textContent).toContain(
      '0 obole',
    );
  });
});
