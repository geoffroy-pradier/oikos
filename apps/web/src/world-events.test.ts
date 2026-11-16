// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from './locales/en.json';
import fr from './locales/fr.json';
import type { WorldEvent } from './world-events';

// Le vrai `useRows`, sur un client Supabase simulé qui compte les lectures ; l'heure du serveur avance
// d'une milliseconde à chaque appel, comme une vraie horloge entre deux rendus.
const calls = vi.hoisted(() => ({ reads: 0, syncs: 0, tick: 0 }));
vi.mock('./supabase', () => {
  const query: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown) => ok({ data: [] }),
  };
  for (const step of ['select', 'eq', 'in', 'gt', 'order', 'limit']) query[step] = () => query;
  return { supabase: { from: () => (calls.reads++, query) } };
});
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
afterEach(() => vi.useRealTimers());

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
});
