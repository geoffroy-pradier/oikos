// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import { parseShipRules, type ShipRules } from '../ship-rules';

// Départ sous la tempête (#417) et par vent favorable (#477) : un caboteur à quai à Kallistè (routes de la configuration initiale :
// Elaia et Ampélos à 4 h, Halos à 6 h), à l'heure du serveur fixée.
const NOW = '2026-11-17T12:00:00.000Z';
// `events` : `loading` tant que la lecture n'a pas répondu, `null` pour une lecture en échec.
// `graces` : de même pour la vue `my_graces`.
const state = vi.hoisted(() => ({
  events: [] as unknown[] | null | 'loading',
  graces: [] as unknown[] | null | 'loading',
  reads: new Map<string, unknown>(),
}));
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, _order: string, filters: unknown) => {
    state.reads.set(view, filters);
    const rows = view === 'world_events' ? state.events : view === 'my_graces' ? state.graces : [];
    if (rows === 'loading')
      return { rows: null, failed: false, reload: () => Promise.resolve(null) };
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
const api = vi.hoisted(() => ({ departVoyage: vi.fn(), done: vi.fn() }));
vi.mock('../api', () => ({ departVoyage: api.departVoyage }));
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
          onDone={(notice) => Promise.resolve(api.done(notice))}
        />
      </HouseProvider>
    </I18nextProvider>,
  );
}
afterEach(() => {
  cleanup();
  api.departVoyage.mockReset();
  api.done.mockReset();
  state.events = [];
  state.graces = [];
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

  it('pendant la lecture des tempêtes, la durée du calme est annoncée comme provisoire', async () => {
    state.events = 'loading';
    await mount();
    expect(screen.getByLabelText(/^Elaia — 4 h de mer, coût/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(fr.departure.stormsLoading);
    state.events = [];
    cleanup();
    await mount();
    // Région toujours présente, vide une fois les tempêtes lues.
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('après un « Réessayer » réussi, le foyer va au titre de la carte', async () => {
    state.events = null;
    await mount();
    state.events = [storm('e1', 'k', 'e', 2_500)];
    const retry = screen.getByRole('button', { name: fr.app.retry });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByText(fr.departure.stormsUnknown)).toBeNull());
    expect(screen.getByLabelText(/^Elaia — 5 h de mer par tempête/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: fr.departure.title }));
  });

  it('une durée allongée égale à celle du calme à l’arrondi n’est pas annoncée comme allongée', async () => {
    // 1 % de 4 h : 4,04 h, soit « 4 h » à l'affichage.
    state.events = [storm('e1', 'k', 'e', 100)];
    await mount();
    expect(screen.getByLabelText(/^Elaia — 4 h de mer, coût/)).toBeTruthy();
    expect(screen.queryByText(/par tempête/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/^Elaia/));
    expect(screen.getByText(/^Tempête entre Kallistè et Elaia jusqu'au /)).toBeTruthy();
  });
});

// Invocation de la maison `h1` lue dans `my_graces`.
const grace = (id: string, invokedAt: string, magnitude: number, more: object = {}) => ({
  id,
  house_id: 'h1',
  grace_id: `g-${id}`,
  god_id: 'poseidon',
  effect: 'fair_wind',
  magnitude_bps: magnitude,
  charis_spent: 100,
  invoked_at: `2026-11-${invokedAt}:00:00+00:00`,
  ready_at: '2026-11-20T00:00:00+00:00',
  consumed_at: null,
  ...more,
});

describe('départ d’un navire : durée raccourcie par un vent favorable en attente (#477)', () => {
  it('le plus ancien vent en attente raccourcit chaque durée annoncée ; la destination choisie le dit', async () => {
    state.graces = [
      grace('w2', '17T09', 5_000),
      grace('w1', '17T08', 2_500),
      // Déjà consommé, d'un autre effet ou d'une autre maison : rien de cela n'est consommé par ce départ.
      grace('w0', '16T08', 5_000, { consumed_at: '2026-11-16T10:00:00+00:00' }),
      grace('b0', '15T08', 5_000, { effect: 'blessed_harvest' }),
      grace('x0', '15T08', 5_000, { house_id: 'h2' }),
    ];
    await mount();
    expect(state.reads.get('my_graces')).toEqual({ house_id: 'h1', effect: 'fair_wind' });
    expect(
      screen.getByLabelText(/^Elaia — 3 h de mer par vent favorable \(4 h sans lui\), coût/),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(/^Halos — 4,5 h de mer par vent favorable \(6 h sans lui\)/),
    ).toBeTruthy();
    expect(screen.queryByText(/^Ce départ consommera/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/^Elaia/));
    expect(
      screen.getByText(
        'Ce départ consommera votre vent favorable de Poséidon, en attente : il retire 1 h au trajet.',
      ),
    ).toBeTruthy();
  });

  it('le vent raccourcit la durée allongée par la tempête ; les trois durées sont dites', async () => {
    state.events = [storm('e1', 'k', 'e', 2_500)];
    state.graces = [grace('w1', '17T08', 2_500)];
    await mount();
    // 4 h × 1,25 = 5 h, puis ⌈18 000 s × 0,75⌉ = 13 500 s.
    expect(
      screen.getByLabelText(
        /^Elaia — 3,8 h de mer par tempête et vent favorable \(5 h sans le vent, 4 h par temps calme\)/,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/^Elaia/));
    expect(screen.getByText(/en attente : il retire 1,3 h au trajet\.$/)).toBeTruthy();
  });

  it('un vent qui ne retire que quelques secondes est consommé et dit, sans changer la durée arrondie', async () => {
    // 1 point de base de 4 h : 1,44 s, soit une seconde de moins à l'arrondi supérieur.
    state.graces = [grace('w1', '17T08', 1)];
    await mount();
    expect(screen.getByLabelText(/^Elaia — 4 h de mer, coût/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/^Elaia/));
    expect(
      screen.getByText(
        'Ce départ consommera votre vent favorable de Poséidon, en attente : il ne retire au trajet que quelques minutes au plus.',
      ),
    ).toBeTruthy();
  });

  it('pendant la lecture des grâces, la durée sans vent est annoncée comme provisoire', async () => {
    state.graces = 'loading';
    await mount();
    expect(screen.getByLabelText(/^Elaia — 4 h de mer, coût/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(fr.departure.windsLoading);
  });

  it('grâces illisibles : la durée sans vent est dite comme telle ; « Réessayer » les relit', async () => {
    state.graces = [{ ...grace('w1', '17T08', 2_500), invoked_at: 'hier' }];
    await mount();
    expect(screen.getByLabelText(/^Elaia — 4 h de mer, coût/)).toBeTruthy();
    expect(screen.getByText(fr.departure.windsUnknown)).toBeTruthy();
    state.graces = [grace('w1', '17T08', 2_500)];
    fireEvent.click(screen.getByRole('button', { name: fr.app.retry }));
    await waitFor(() => expect(screen.queryByText(fr.departure.windsUnknown)).toBeNull());
    expect(screen.getByLabelText(/^Elaia — 3 h de mer par vent favorable/)).toBeTruthy();
  });

  it('le départ fait dit les secondes que le vent a retirées, d’après la réponse de l’API', async () => {
    state.graces = [grace('w1', '17T08', 2_500)];
    api.departVoyage.mockResolvedValue({
      ok: true,
      replayed: false,
      data: {
        toCityId: 'e',
        arrivesAt: '2026-11-17T15:00:00Z',
        costOboles: 0,
        fairWind: { graceUseId: 'w1', graceId: 'g-w1', savedSeconds: 3_600 },
      },
    });
    await mount();
    fireEvent.click(screen.getByLabelText(/^Elaia/));
    fireEvent.click(screen.getByRole('button', { name: /^Partir vers Elaia/ }));
    await waitFor(() => expect(api.done).toHaveBeenCalled());
    expect(api.done.mock.calls[0]?.[0]).toMatchObject({
      kind: 'status',
      text: expect.stringMatching(/ Le vent favorable a raccourci le trajet de 1 h\.$/),
    });
  });
});
