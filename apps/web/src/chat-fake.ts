import { useState } from 'react';
import type { LiveState } from './chat-live';

/**
 * Doublures des tests de l'onglet Messages (#274), jamais importées par l'application : lectures simulées par
 * vue et par filtre (`useRows`), abonnements Realtime simulés (`useChatLive`).
 */
type Filters = Record<string, unknown> | null;
export const fake = {
  channels: [] as unknown[] | null,
  messages: [] as Record<string, unknown>[],
  houses: [] as unknown[],
  live: 'connecting' as LiveState,
  topics: null as readonly string[] | null,
  signal: (() => undefined) as (channelId?: string) => void,
  cache: new Map<string, unknown[] | null>(),
  /** Lectures demandées (vue et filtre), et relectures, dans l'ordre. */
  reads: [] as { view: string; filters: Filters }[],
  reloads: [] as string[],
};

export const at = (minute: number) => `2026-11-17T10:${String(minute).padStart(2, '0')}:00.000Z`;
export const channelRow = (
  id: string,
  kind: 'city' | 'direct',
  other: string | null,
  minute: number,
) => ({
  id,
  kind,
  world_id: 'w1',
  city_id: kind === 'city' ? 'c1' : null,
  other_house_id: other,
  created_at: at(minute),
});
export const messageRow = (
  id: string,
  channelId: string,
  houseId: string,
  minute: number,
  hidden = false,
) => ({
  id,
  channel_id: channelId,
  house_id: houseId,
  body: hidden ? null : `Texte ${id}`,
  created_at: at(minute),
  hidden_at: hidden ? at(minute) : null,
});

/** Un canal de la cité (`city`), une conversation avec Philaïdes (`dm`), et leurs messages. */
export function resetFake() {
  fake.channels = [channelRow('city', 'city', null, 0), channelRow('dm', 'direct', 'h2', 1)];
  fake.houses = [
    { id: 'h1', name: 'Test', citizenship_status: 'metic' },
    { id: 'h2', name: 'Philaïdes', citizenship_status: 'citizen' },
    { id: 'h3', name: 'Bacchiades', citizenship_status: 'metic' },
  ];
  fake.messages = [
    messageRow('m1', 'city', 'h3', 2),
    messageRow('m2', 'city', 'h1', 3),
    messageRow('m3', 'city', 'h3', 4, true),
    messageRow('d1', 'dm', 'h2', 5),
    messageRow('d2', 'dm', 'h2', 6),
  ];
  fake.live = 'connecting';
  fake.topics = null;
  fake.cache.clear();
  fake.reads = [];
  fake.reloads = [];
}

const rowsFor = (view: string, filters: Filters): unknown[] | null => {
  if (filters === null) return null;
  if (view === 'my_channels') return fake.channels && [...fake.channels];
  if (view === 'houses') return [...fake.houses];
  const neq = (filters['house_id'] as { neq?: string } | undefined)?.neq;
  const channel = filters['channel_id'];
  return fake.messages.filter(
    (row) =>
      (neq === undefined || row['house_id'] !== neq) &&
      (Array.isArray(channel)
        ? channel.includes(row['channel_id'])
        : row['channel_id'] === channel),
  );
};

/** Comme le vrai `useRows` : les mêmes lignes d'un rendu à l'autre tant qu'elles ne changent pas. */
export function useFakeRows(view: string, _columns: string, _order: string, filters: Filters = {}) {
  const [, rerender] = useState(0);
  fake.reads.push({ view, filters });
  const fresh = rowsFor(view, filters);
  const key = `${view}:${JSON.stringify(filters)}`;
  const cached = fake.cache.get(key);
  const rows =
    cached !== undefined && JSON.stringify(cached) === JSON.stringify(fresh) ? cached : fresh;
  fake.cache.set(key, rows);
  const tag = filters && 'house_id' in filters ? 'non-lus' : String(filters?.['channel_id'] ?? '');
  const tagged = `${view}:${tag}`;
  return {
    rows,
    failed: filters !== null && rows === null,
    reload: () => (fake.reloads.push(tagged), rerender((n) => n + 1), Promise.resolve(rows)),
  };
}

export function useFakeChatLive(
  topics: readonly string[] | null,
  onSignal: (channelId?: string) => void,
) {
  fake.topics = topics;
  fake.signal = onSignal;
  return fake.live;
}
