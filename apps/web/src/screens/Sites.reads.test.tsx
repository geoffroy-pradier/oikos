// @vitest-environment jsdom
import { INITIAL_CONFIG } from '@oikos/config';
import { act, render } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Écran Sites avec le vrai `useRows` (#417) : client Supabase simulé qui compte les lectures de chaque vue,
// heure du serveur qui avance d'une milliseconde à chaque appel.
const calls = vi.hoisted(() => ({ reads: new Map<string, number>(), syncs: 0, tick: 0 }));
vi.mock('../supabase', () => ({
  supabase: {
    from: (view: string) => {
      calls.reads.set(view, (calls.reads.get(view) ?? 0) + 1);
      const data =
        view === 'my_sites'
          ? [
              {
                id: 's1',
                city_id: 'c1',
                recipe_id: 'grow_wheat',
                cycle_started_at: '2026-11-17T00:00:00Z',
              },
            ]
          : view === 'site_rules'
            ? [INITIAL_CONFIG]
            : [];
      const query: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown) => ok({ data }),
      };
      for (const step of ['select', 'eq', 'in', 'gt', 'order', 'limit']) query[step] = () => query;
      return query;
    },
  },
}));
vi.mock('../server-clock', () => ({
  serverClock: { now: () => new Date(Date.now() + ++calls.tick) },
  syncServerClock: () => (calls.syncs++, Promise.resolve()),
}));
const { SitesCard } = await import('./Sites');
afterEach(() => vi.useRealTimers());

describe('écran Sites : lectures bornées des événements (#417)', () => {
  it('une lecture des événements une fois les sites lus, puis une par minute ; rien après le démontage', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-17T12:00:00Z') });
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    const house = { id: 'h1', name: 'T', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
    const { unmount } = render(
      <I18nextProvider i18n={instance}>
        <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
          <SitesCard stock={[]} onChanged={() => Promise.resolve()} />
        </HouseProvider>
      </I18nextProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect([calls.reads.get('my_sites'), calls.reads.get('world_events')]).toEqual([1, 1]);
    await act(() => vi.advanceTimersByTimeAsync(3 * 60_000));
    expect([calls.reads.get('my_sites'), calls.reads.get('world_events')]).toEqual([4, 4]);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect([calls.reads.get('world_events'), calls.syncs]).toEqual([4, 2]);
  });
});
