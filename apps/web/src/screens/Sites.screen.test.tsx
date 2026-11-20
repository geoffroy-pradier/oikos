// @vitest-environment jsdom
import { INITIAL_CONFIG } from '@oikos/config';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Écran Sites : un champ, 500 drachmes en trésorerie.
const views: Record<string, object[]> = {
  my_sites: [
    {
      id: 's1',
      city_id: 'c1',
      recipe_id: 'grow_wheat',
      cycle_started_at: '2026-01-01T00:00:00Z',
      halted_at: null,
    },
  ],
  my_treasury: [{ balance: 3000 }],
  my_inventories: [{ id: 'i1', city_id: 'c1', good_id: 'wheat', quantity: 40, reserved: 0 }],
};
vi.mock('../data', async () => {
  const { parseSiteRules } = await import('../site-rules');
  const rules = parseSiteRules(INITIAL_CONFIG);
  return {
    useRows: (view: string) => ({
      rows: views[view] ?? [],
      failed: false,
      reload: () => Promise.resolve(views[view] ?? []),
    }),
    useSiteRules: () => ({ rules, failed: false, reload: () => Promise.resolve() }),
    useClockRules: () => ({ rules: null, failed: false, reload: () => Promise.resolve() }),
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: React.ReactNode; to: string; 'aria-current'?: 'page' }) => (
    <a href={props.to} aria-current={props['aria-current']}>
      {props.children}
    </a>
  ),
  useRouterState: () => '/sites',
}));
const { SitesScreen } = await import('./Sites');

afterEach(cleanup);

describe('écran Sites', () => {
  it('son titre, les rubriques de la maison et ses chiffres clés', async () => {
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
    render(
      <I18nextProvider i18n={instance}>
        <HouseProvider
          value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
        >
          <SitesScreen />
        </HouseProvider>
      </I18nextProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: fr.home.sites })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: fr.home.sectionsNav });
    const current = [...nav.querySelectorAll('a[aria-current="page"]')].map((a) => a.textContent);
    expect(current).toEqual([fr.home.nav.sites]);
    expect(await screen.findByText('500 drachmes')).toBeTruthy();
    expect(screen.getByText('1 sur 4')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Champ de blé' })).toBeTruthy();
  });
});
