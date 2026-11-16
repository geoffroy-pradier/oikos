// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { act, render } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import { parseShipRules, type ShipRules } from '../ship-rules';

// Écran Départ avec le vrai `useRows` (#456) : client Supabase simulé qui compte les lectures de chaque vue,
// heure du serveur qui avance d'une milliseconde à chaque appel.
const calls = vi.hoisted(() => ({ reads: new Map<string, number>(), syncs: 0, tick: 0 }));
vi.mock('../supabase', () => ({
  supabase: {
    from: (view: string) => {
      calls.reads.set(view, (calls.reads.get(view) ?? 0) + 1);
      const query: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) => ok({ data: [] }),
      };
      for (const step of ['select', 'eq', 'in', 'gt', 'order', 'limit']) query[step] = () => query;
      return query;
    },
  },
}));
vi.mock('../api', () => ({ departVoyage: vi.fn() }));
vi.mock('../server-clock', () => ({
  serverClock: { now: () => new Date(Date.now() + ++calls.tick) },
  syncServerClock: () => (calls.syncs++, Promise.resolve()),
}));
const { Departure } = await import('./Departure');
afterEach(() => vi.useRealTimers());

const SLUGS = new Map(Object.entries({ k: 'kalliste', e: 'elaia', a: 'ampelos', h: 'halos' }));
const RULES = parseShipRules({ ships: (INITIAL_CONFIG as GameConfig).ships }) as ShipRules;

describe('départ d’un navire : lectures bornées (#456)', () => {
  it('stock lu une fois ; tempêtes lues deux fois (borne reprise), puis une par minute ; rien après le démontage', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-17T12:00:00Z') });
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    const house = { id: 'h1', name: 'T', cityId: 'k', accessToken: 't', cityName: 'Kallistè' };
    const { unmount } = render(
      <I18nextProvider i18n={instance}>
        <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
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
    const counts = () => [calls.reads.get('my_inventories'), calls.reads.get('world_events')];
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(counts()).toEqual([1, 2]);
    await act(() => vi.advanceTimersByTimeAsync(3 * 60_000));
    expect(counts()).toEqual([1, 5]);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect([...counts(), calls.syncs]).toEqual([1, 5, 1]);
  });
});
