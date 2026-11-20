// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Onglet Cité (#259) : lectures simulées, vue par vue.
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
const { CityScreen } = await import('./City');

const day = {
  city_id: 'c1',
  game_day: 20000,
  supply: 40,
  employed: 30,
  unhoused: 6,
  wage_oboles: 7,
  lodging_oboles: 3,
};
async function show(screenElement: ReactNode) {
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
        value={{ ...house, cityNames: { c1: 'Kallistè', c2: 'Elaia' }, citizenshipStatus: 'metic' }}
      >
        {screenElement}
      </HouseProvider>
    </I18nextProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.views = {};
});

describe('onglet Cité : marché du travail et parc (#259)', () => {
  it('salaire du jour, taux d’emploi, hébergement et parc par taille', async () => {
    state.views = {
      labor_market: [day],
      city_properties: [
        { id: 'p1', size_id: 'townhouse', for_sale: true },
        { id: 'p2', size_id: 'townhouse', for_sale: false },
      ],
    };
    await show(<CityScreen />);
    expect(screen.getByText('Salaire du jour : 1 drachme 1 obole par travailleur')).toBeTruthy();
    expect(screen.getByText(/^Taux d'emploi : 75\s?%/)).toBeTruthy();
    expect(screen.getByText('Hébergement chez les habitants : 3 oboles la nuit')).toBeTruthy();
    expect(
      screen.getByText('Maison de ville : 2 au total, dont 1 encore à vendre par la cité'),
    ).toBeTruthy();
  });

  it('marché pas encore fixé, offre sans limite', async () => {
    state.views = { labor_market: [] };
    await show(<CityScreen />);
    expect(screen.getByText(fr.city.labor.none)).toBeTruthy();
    cleanup();
    state.views = { labor_market: [{ ...day, supply: 0 }] };
    await show(<CityScreen />);
    expect(screen.getByText('30 employés ; main-d’œuvre sans limite')).toBeTruthy();
    cleanup();
    state.views = { labor_market: [{ ...day, supply: 0, employed: 1 }] };
    await show(<CityScreen />);
    expect(screen.getByText('1 employé ; main-d’œuvre sans limite')).toBeTruthy();
  });
});

describe('onglet Cité : sous-sections en pastilles (#697)', () => {
  it('cinq pastilles, la vie politique d’abord ; les panneaux quittés restent montés, cachés', async () => {
    await show(<CityScreen />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Vie politique',
      'Assemblée',
      'Trésor',
      'Événements',
      'Chronique',
    ]);
    expect(screen.getByRole('tabpanel', { name: 'Vie politique' })).toBeTruthy();
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(5);
    fireEvent.click(screen.getByRole('tab', { name: 'Trésor' }));
    const panel = screen.getByRole('tabpanel', { name: 'Trésor' });
    expect(panel.querySelector('h2')?.textContent).toBe(fr.treasury.title);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });
});
