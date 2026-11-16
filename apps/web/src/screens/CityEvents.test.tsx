// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Onglet Cité, événements en cours (#417) : la lecture de `world_events` est simulée, l'heure du serveur fixée.
const NOW = '2026-11-17T12:00:00.000Z';
const state = vi.hoisted(() => ({
  rows: [] as unknown[] | null,
  reads: [] as { view: string; filters: unknown }[],
  reloads: 0,
}));
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, _order: string, filters: unknown) => {
    state.reads.push({ view, filters });
    return {
      rows: state.rows,
      failed: state.rows === null,
      reload: () => (state.reloads++, Promise.resolve(state.rows)),
    };
  },
}));
vi.mock('../server-clock', () => ({
  serverClock: { now: () => new Date(NOW) },
  syncServerClock: () => Promise.resolve(),
}));
const { CityEvents } = await import('./CityEvents');

const event = (id: string, model: string, extra: object = {}) => ({
  id,
  model,
  city_id: 'c1',
  other_city_id: null,
  good_id: null,
  starts_at: '2026-11-16T08:00:00Z',
  ends_at: '2026-11-18T08:00:00Z',
  magnitude_bps: 3_000,
  ...extra,
});
async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
      >
        <CityEvents />
      </HouseProvider>
    </I18nextProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.rows = [];
  state.reads = [];
  state.reloads = 0;
});

describe('onglet Cité : événements en cours de la cité (#417)', () => {
  it('lit les événements de la cité qui finissent après l’heure du serveur ; aucun : la carte le dit', async () => {
    await show();
    expect(state.reads.at(-1)).toEqual({
      view: 'world_events',
      filters: { city_id: 'c1', model: ['drought', 'good_year', 'caravan'], ends_at: { gt: NOW } },
    });
    expect(screen.getByText(fr.worldEvents.none)).toBeTruthy();
  });

  it('sécheresse, bonne année et caravane en cours, chacune avec son effet ; un événement fini est tu', async () => {
    state.rows = [
      event('e1', 'drought'),
      event('e2', 'good_year', { magnitude_bps: 1_500 }),
      event('e3', 'caravan', { good_id: 'wine', magnitude_bps: 5_000 }),
      // Fini depuis la lecture : l'écran est resté ouvert, l'heure du serveur a passé sa fin.
      event('e4', 'drought', { ends_at: '2026-11-17T11:00:00Z' }),
    ];
    await show();
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/^Sécheresse à Kallistè jusqu'au .* rend 30\s?% de moins\.$/);
    expect(items[1]).toMatch(/^Bonne année à Kallistè .* rend 15\s?% de plus\.$/);
    expect(items[2]).toMatch(/^Caravane étrangère à Kallistè .* 50\s?% de plus du bien « Vin »\.$/);
  });

  it('lecture en échec : annoncée, et relire est proposé au clavier', async () => {
    state.rows = null;
    await show();
    expect(screen.getByRole('alert').textContent).toBe(fr.app.loadFailed);
    expect(screen.queryByText(fr.worldEvents.none)).toBeNull();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });

  it('« Réessayer » relit la carte : les événements paraissent et le foyer va au titre', async () => {
    state.rows = null;
    await show();
    state.rows = [event('e2', 'good_year', { magnitude_bps: 1_500 })];
    const retry = screen.getByRole('button', { name: fr.app.retry });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(state.reloads).toBe(1);
    expect(screen.getByRole('listitem').textContent).toMatch(/^Bonne année à Kallistè /);
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: fr.worldEvents.title }),
    );
  });
});
