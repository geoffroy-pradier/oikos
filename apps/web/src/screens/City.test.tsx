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
  useClockRules: () => ({ rules: null }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode; 'aria-label'?: string }) => (
    <a href="/" aria-label={props['aria-label']}>
      {children}
    </a>
  ),
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

  it('offre à NULL (sans limite) : la carte se lit, sans taux d’emploi (#896)', async () => {
    state.views = { labor_market: [{ ...day, supply: null }] };
    await show(<CityScreen />);
    expect(screen.getByText('30 employés ; main-d’œuvre sans limite')).toBeTruthy();
  });

  it('marché pas encore fixé, offre sans limite', async () => {
    state.views = { labor_market: [] };
    await show(<CityScreen />);
    expect(screen.getByText(fr.city.labor.none)).toBeTruthy();
    cleanup();
    state.views = { labor_market: [{ ...day, supply: null, employed: 1 }] };
    await show(<CityScreen />);
    expect(screen.getByText('1 employé ; main-d’œuvre sans limite')).toBeTruthy();
    cleanup();
    // Offre de 0 (#896) : des classes travaillent mais n'ont personne à embaucher, pas « sans limite ».
    state.views = { labor_market: [{ ...day, supply: 0 }] };
    await show(<CityScreen />);
    expect(screen.getByText('Aucun travailleur disponible ; 30 employés')).toBeTruthy();
    expect(screen.queryByText(/sans limite/)).toBeNull();
  });
});

describe('onglet Cité : sous-sections en pastilles (#697)', () => {
  it('les pastilles, la vie politique d’abord ; les panneaux quittés restent montés, cachés', async () => {
    await show(<CityScreen />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Vie politique',
      'Assemblée',
      'Liturgies',
      'Trésor',
      'Événements',
      'Chronique',
    ]);
    expect(screen.getByRole('tabpanel', { name: 'Vie politique' })).toBeTruthy();
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(6);
    fireEvent.click(screen.getByRole('tab', { name: 'Trésor' }));
    const panel = screen.getByRole('tabpanel', { name: 'Trésor' });
    expect(panel.querySelector('h2')?.textContent).toBe(fr.treasury.title);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });
});

describe('onglet Cité : en-tête et vue d’ensemble (#697)', () => {
  it('lien du temple nommé en entier, identité illustrée, population détaillée par classe', async () => {
    state.views = {
      city_identity: [
        {
          city_id: 'c1',
          terroir: null,
          has_port: true,
          patron_god_id: 'demeter',
          starting_recipe_id: 'wheat_field',
        },
      ],
      city_population: [{ class_id: 'thetes', population: 1200, coverage_bps: 5000 }],
    };
    await show(<CityScreen />);
    // Le libellé visible ouvre le nom accessible (WCAG 2.5.3).
    const temple = screen.getByRole('link', { name: fr.city.templeLink });
    expect(temple.textContent).toBe(fr.city.temple);
    expect(screen.getByText('Protégée par Déméter')).toBeTruthy();
    expect(screen.getByText(/^1\s200 habitants au total$/)).toBeTruthy();
    const details = screen.getByText(fr.city.byClass).closest('details');
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('Thètes');
  });
});
