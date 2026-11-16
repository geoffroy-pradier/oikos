// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from './locales/en.json';
import fr from './locales/fr.json';
import type { WorldEvent } from './world-events';

// Le vrai `useRows`, sur un client Supabase simulé qui compte les lectures, retient chaque borne `gt` et ne
// rend que les lignes qui finissent après elle ; l'heure du serveur avance d'une milliseconde à chaque appel,
// comme une vraie horloge entre deux rendus.
const calls = vi.hoisted(() => ({
  reads: 0,
  syncs: 0,
  tick: 0,
  rows: [] as { ends_at: string }[],
  bounds: [] as string[],
}));
vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      calls.reads++;
      let bound = '';
      const query: Record<string, unknown> = {
        gt: (_column: string, value: string) => (calls.bounds.push((bound = value)), query),
        then: (ok: (v: unknown) => unknown) =>
          ok({ data: calls.rows.filter((row) => Date.parse(row.ends_at) > Date.parse(bound)) }),
      };
      for (const step of ['select', 'eq', 'in', 'order', 'limit']) query[step] = () => query;
      return query;
    },
  },
}));
vi.mock('./server-clock', () => ({
  serverClock: { now: () => new Date(Date.now() + ++calls.tick) },
  syncServerClock: () => (calls.syncs++, Promise.resolve()),
}));
const { describeWorldEvent, inForce, parseWorldEvents, useWorldEvents } =
  await import('./world-events');

const row = {
  id: 'e1',
  model: 'drought',
  city_id: 'c1',
  other_city_id: null,
  good_id: null,
  starts_at: '2026-11-16T08:00:00Z',
  ends_at: '2026-11-18T08:00:00Z',
  magnitude_bps: 4_000,
};
afterEach(() => {
  vi.useRealTimers();
  Object.assign(calls, { reads: 0, syncs: 0, rows: [], bounds: [] });
});

describe('événements du monde lus de la vue `world_events` (#417)', () => {
  it('une ligne illisible ou d’un modèle inconnu du client est ignorée, pas les autres', () => {
    const rows = [
      { ...row, id: 'unknown', model: 'plague' },
      { ...row, id: 'date', ends_at: 'demain' },
      { ...row, id: 'big', magnitude_bps: 10_001 },
      { city_id: 'c1', recipe_id: 'grow_wheat' },
      { ...row, id: 'ok' },
    ];
    expect(parseWorldEvents(rows).map((event) => event.id)).toEqual(['ok']);
  });

  it('en cours : le début compris, la fin exclue', () => {
    const [event] = parseWorldEvents([row]) as [WorldEvent];
    const at = (iso: string) => inForce([event], new Date(iso)).length;
    expect(at('2026-11-16T07:59:59.999Z')).toBe(0);
    expect(at('2026-11-16T08:00:00Z')).toBe(1);
    expect(at('2026-11-18T07:59:59.999Z')).toBe(1);
    expect(at('2026-11-18T08:00:00Z')).toBe(0);
  });

  it('un événement se dit en une phrase, en français et en anglais', async () => {
    const t = i18next.createInstance();
    await t.init({ resources: { fr: { translation: fr }, en: { translation: en } }, lng: 'fr' });
    const storm = { ...row, model: 'storm', other_city_id: 'c2', magnitude_bps: 2_550 };
    const [drought, onRoute] = parseWorldEvents([row, storm]) as [WorldEvent, WorldEvent];
    const end = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short' }).format(
      drought.endsAt,
    );
    expect(describeWorldEvent(onRoute, t.t, 'fr', { c1: 'Kallistè', c2: 'Elaia' })).toMatch(
      new RegExp(`^Tempête entre Kallistè et Elaia jusqu'au ${end} : .* 25,5\\s?% de plus\\.$`),
    );
    await t.changeLanguage('en');
    expect(describeWorldEvent(drought, t.t, 'en', {})).toMatch(
      /^Drought in c1 until .*: each field cycle yields 40% less\.$/,
    );
    const others = [
      { ...row, model: 'good_year', magnitude_bps: 1_500 },
      { ...row, model: 'caravan', good_id: 'wine', magnitude_bps: 5_000 },
    ];
    const [goodYear, caravan] = parseWorldEvents(others) as [WorldEvent, WorldEvent];
    const names = { c1: 'Kallistè' };
    expect(describeWorldEvent(goodYear, t.t, 'en', names)).toMatch(
      /^Good year in Kallistè until .*: each orchard cycle yields 15% more\.$/,
    );
    expect(describeWorldEvent(caravan, t.t, 'en', names)).toMatch(
      /^Foreign caravan in Kallistè until .*: the inhabitants buy 50% more of Wine\.$/,
    );
  });

  it('lectures bornées : la borne reprise une fois, une relecture par minute, rien après le démontage', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-17T12:00:00Z') });
    const removed = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useWorldEvents({ city_id: 'c1' }));
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    // L'heure du serveur est lue une fois ; la borne reprise relit une fois.
    expect([calls.syncs, calls.reads]).toEqual([1, 2]);
    await act(() => vi.advanceTimersByTimeAsync(3 * 60_000));
    expect(calls.reads).toBe(5);
    unmount();
    expect(removed).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect([calls.syncs, calls.reads]).toEqual([1, 5]);
  });

  it('longue session : un événement fini depuis l’ouverture n’est plus gardé dans les lignes lues', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-17T12:00:00Z') });
    // Fini à 12 h 01 min 30 s, entre la première et la deuxième relecture de la minute.
    calls.rows = [
      { ...row, ends_at: '2026-11-17T12:01:30Z' },
      { ...row, id: 'e2' },
    ];
    const shown: (WorldEvent[] | null)[] = [];
    const { result, unmount } = renderHook(() => {
      const read = useWorldEvents({ city_id: 'c1' });
      shown.push(read.events);
      return read;
    });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(result.current.events?.map((event) => event.id)).toEqual(['e1', 'e2']);
    const loaded = shown.length;
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(calls.bounds).toHaveLength(3);
    expect(new Set(calls.bounds).size).toBe(2);
    // 12 h 02 : e1 est fini. La borne avance, la lecture sous elle tient lieu de relecture ; e1 n'est plus lu.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(calls.reads).toBe(4);
    expect(Date.parse(calls.bounds.at(-1) ?? '')).toBeGreaterThanOrEqual(
      Date.parse('2026-11-17T12:02:00Z'),
    );
    expect(result.current.events?.map((event) => event.id)).toEqual(['e2']);
    // Pendant la lecture sous la nouvelle borne, l'écran ne repasse pas par le chargement.
    expect(shown.slice(loaded).includes(null)).toBe(false);
    // Plus rien de fini parmi les lignes lues : la borne ne bouge plus, une relecture par minute.
    await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
    expect(calls.reads).toBe(6);
    expect(new Set(calls.bounds).size).toBe(3);
    unmount();
  });
});
