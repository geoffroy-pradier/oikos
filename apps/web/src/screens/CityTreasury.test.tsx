// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Trésor public de l'onglet Cité (#264) : lectures simulées vue par vue.
const state = vi.hoisted(() => ({
  views: {} as Record<string, unknown[] | null>,
  latest: {} as Record<string, unknown>,
}));
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, order: string, _filters: unknown, latest?: unknown) => {
    state.latest[view] = latest === undefined ? undefined : { order, ...(latest as object) };
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
const { CityTreasury } = await import('./CityTreasury');

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
        <CityTreasury />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const rates = [{ city_id: 'c1', market_tax_rate_bps: 800, port_dues_coefficient_bps: 15000 }];
afterEach(() => {
  cleanup();
  state.views = {};
});

describe('trésor public de la cité (#264)', () => {
  it('solde, taxes en vigueur, flux par jour et par nature avec leur net', async () => {
    state.views = {
      city_treasury: [{ city_id: 'c1', balance: 1200 }],
      city_rates: rates,
      city_treasury_flows: [
        { city_id: 'c1', game_day: 20406, nature: 'market_tax', amount: 54 },
        { city_id: 'c1', game_day: 20406, nature: 'public_works', amount: -600 },
        { city_id: 'c1', game_day: 20405, nature: 'other', amount: 6 },
      ],
    };
    await show();
    expect(screen.getByText('Solde : 200 drachmes')).toBeTruthy();
    expect(screen.getByText(/^Taxe de marché en vigueur : 8\s?%$/)).toBeTruthy();
    expect(screen.getByText('Droit de port en vigueur : coefficient 1,5')).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatch(/2025 : net −91 drachmes$/);
    expect(screen.getByText('Taxe de marché : 9 drachmes')).toBeTruthy();
    expect(screen.getByText('Grands travaux : −100 drachmes')).toBeTruthy();
    expect(screen.getByText('Autres mouvements : 1 drachme')).toBeTruthy();
    // Les flux se lisent les plus récents d'abord : sept jours entiers de cinq natures au plus.
    expect(state.latest['city_treasury_flows']).toEqual({ order: 'game_day', limit: 35 });
  });

  it('trésor vide sans mouvement ; lecture en échec annoncée', async () => {
    state.views = { city_rates: rates };
    await show();
    expect(screen.getByText('Solde : 0 obole')).toBeTruthy();
    expect(screen.getByText(fr.treasury.noFlows)).toBeTruthy();
    cleanup();
    state.views = { city_rates: rates, city_treasury_flows: null };
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });

  it('chiffres clés en cartes, barres décrites doublées d’un tableau des mêmes valeurs (#697)', async () => {
    state.views = {
      city_treasury: [{ city_id: 'c1', balance: 1200 }],
      city_rates: rates,
      city_treasury_flows: [
        { city_id: 'c1', game_day: 20406, nature: 'market_tax', amount: 54 },
        { city_id: 'c1', game_day: 20406, nature: 'public_works', amount: -600 },
        { city_id: 'c1', game_day: 20405, nature: 'other', amount: 6 },
      ],
    };
    await show();
    // La carte est une image pour l'œil ; le lecteur d'écran lit la phrase entière.
    expect(screen.getByText(fr.treasury.figures.balance).closest('[aria-hidden]')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Recettes et dépenses du trésor sur 2 jours : 10 drachmes de recettes, 100 drachmes de dépenses.',
    );
    const rows = screen
      .getAllByRole('row', { hidden: true })
      .slice(1)
      .map((row) => [...row.children].map((cell) => cell.textContent));
    expect(rows).toEqual([
      [expect.stringMatching(/2025$/), '9 drachmes', '100 drachmes', '−91 drachmes'],
      [expect.stringMatching(/2025$/), '1 drachme', '0 obole', '1 drachme'],
    ]);
  });
});
