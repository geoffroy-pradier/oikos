// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import { parseShipRules, type ShipRules } from '../ship-rules';

// Départ sous la tempête (#417) : un caboteur à quai à Kallistè (routes de la configuration initiale :
// Elaia et Ampélos à 4 h, Halos à 6 h), à l'heure du serveur fixée.
const NOW = '2026-11-17T12:00:00.000Z';
const state = vi.hoisted(() => ({
  events: [] as unknown[] | null,
  reads: new Map<string, unknown>(),
}));
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, _order: string, filters: unknown) => {
    state.reads.set(view, filters);
    const rows = view === 'world_events' ? state.events : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
vi.mock('../api', () => ({ departVoyage: vi.fn() }));
vi.mock('../server-clock', () => ({
  serverClock: { now: () => new Date(NOW) },
  syncServerClock: () => Promise.resolve(),
}));
const { Departure } = await import('./Departure');

const SLUGS = new Map(Object.entries({ k: 'kalliste', e: 'elaia', a: 'ampelos', h: 'halos' }));
const RULES = parseShipRules({ ships: (INITIAL_CONFIG as GameConfig).ships }) as ShipRules;
const storm = (id: string, from: string, to: string, magnitude: number, ends = '18') => ({
  id,
  model: 'storm',
  city_id: from,
  other_city_id: to,
  good_id: null,
  starts_at: '2026-11-17T08:00:00Z',
  ends_at: `2026-11-${ends}T08:00:00Z`,
  magnitude_bps: magnitude,
});
async function mount() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'k', accessToken: 't', cityName: 'Kallistè' };
  const names = { k: 'Kallistè', e: 'Elaia', a: 'Ampélos', h: 'Halos' };
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: names, citizenshipStatus: 'metic' }}>
        <Departure
          ship={{ id: 's1', class_id: 'coaster', docked_city_id: 'k', laid_up_at: null }}
          shipName="Caboteur"
          rules={RULES}
          slugs={SLUGS}
          voyageCounts={new Map()}
          onDone={() => Promise.resolve()}
        />
      </HouseProvider>
    </I18nextProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.events = [];
  state.reads.clear();
});

describe('départ d’un navire : durée allongée par une tempête en cours sur sa route (#417)', () => {
  it('lit les tempêtes des cités du monde qui finissent après l’heure du serveur', async () => {
    await mount();
    expect(state.reads.get('world_events')).toEqual({
      model: 'storm',
      city_id: ['a', 'e', 'h', 'k'],
      ends_at: { gt: NOW },
    });
  });

  it('la plus forte tempête de la route, dans un sens ou dans l’autre ; à égalité, la plus ancienne', async () => {
    state.events = [
      storm('e1', 'e', 'k', 2_500, '18'),
      storm('e0', 'k', 'e', 2_500, '19'),
      storm('e2', 'k', 'e', 1_000),
      storm('e3', 'h', 'k', 10_000),
      // Une tempête d'une autre route, une tempête finie : le trajet vers Ampélos n'est pas touché.
      storm('e4', 'e', 'a', 10_000),
      { ...storm('e5', 'a', 'k', 10_000), ends_at: '2026-11-17T11:00:00Z' },
    ];
    await mount();
    expect(
      screen.getByLabelText(/^Elaia — 5 h de mer par tempête \(4 h par temps calme\)/),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(/^Halos — 12 h de mer par tempête \(6 h par temps calme\)/),
    ).toBeTruthy();
    expect(screen.getByLabelText(/^Ampélos — 4 h de mer, coût/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/^Elaia/));
    const end = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date('2026-11-19T08:00:00Z'),
    );
    expect(
      screen.getByText(
        new RegExp(`^Tempête entre Kallistè et Elaia jusqu'au ${end} : .* 25\\s?% de plus\\.$`),
      ),
    ).toBeTruthy();
  });

  it('tempêtes illisibles : la durée du calme est annoncée comme telle, relire est proposé', async () => {
    state.events = null;
    await mount();
    expect(screen.getByLabelText(/^Elaia — 4 h de mer, coût/)).toBeTruthy();
    expect(screen.getByText(fr.departure.stormsUnknown)).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });
});
