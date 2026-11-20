// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Personnel de la maison (#259) : lectures simulées, vue par vue.
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
  useClockRules: () => ({ rules: null, failed: false, reload: () => Promise.resolve() }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useRouterState: () => '/personnel',
}));
const { StaffScreen } = await import('./Staff');

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

describe('personnel de la maison (#259)', () => {
  it('travailleurs par cité, logés ou non, et l’hébergement d’un jour au prix de la cité', async () => {
    state.views = {
      labor_market: [day],
      my_workforce: [
        { site_id: 's1', city_id: 'c1', workers: 4, housed: 1, unhoused: 3 },
        { site_id: 's2', city_id: 'c2', workers: 2, housed: 2, unhoused: 0 },
      ],
    };
    await show(<StaffScreen />);
    // Le tableau (fiches sur téléphone) : une ligne par cité, ses travailleurs logés ou non.
    const table = within(screen.getByRole('table', { name: fr.staff.byCity }));
    const cells = (city: string) =>
      within(table.getByRole('row', { name: new RegExp(`^${city}`) }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    // 3 nuits à 3 oboles : 1 drachme 3 oboles.
    expect(cells('Kallistè')).toEqual(['4', '1', '3', '1 drachme 3 oboles']);
    // Elaia n'a pas encore de marché du travail : le prix est inconnu, jamais nul.
    expect(cells('Elaia')).toEqual(['2', '2', '0', fr.staff.lodgingPending]);
    expect(screen.getByText(fr.staff.lodgingUnknown)).toBeTruthy();
    // Les totaux en cartes ; l'hébergement ne compte que les cités dont le prix est fixé, et le dit.
    const figures = within(screen.getByRole('list', { name: fr.staff.figures }));
    expect(figures.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Travailleurs6',
      'Logés par vos biens3',
      'Hébergés chez les habitants3',
      'Hébergement par jour1 drachme 3 obolesHors 1 cité au prix pas encore fixé',
    ]);
  });

  it('sans site : rien à montrer ; lecture en échec : annoncée', async () => {
    await show(<StaffScreen />);
    expect(screen.getByText(fr.staff.empty)).toBeTruthy();
    expect(screen.getByRole('link', { name: fr.home.acquire }).getAttribute('href')).toBe('/sites');
    cleanup();
    state.views = { my_workforce: null };
    await show(<StaffScreen />);
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });
});
