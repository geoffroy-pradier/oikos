import { describe, expect, it } from 'vitest';
import {
  markRead,
  parseChannels,
  parseMessages,
  readMarks,
  unreadCounts,
  unreadSince,
  type Channel,
  type Message,
} from './chat';
import type { KeyStorage } from './pending-keys';

const at = (minute: number) => `2026-11-17T10:${String(minute).padStart(2, '0')}:00.000Z`;
const ms = (minute: number) => Date.parse(at(minute));
const channelRow = (id: string, kind: 'city' | 'direct', minute: number, extra = {}) => ({
  id,
  kind,
  world_id: 'w1',
  city_id: kind === 'city' ? 'kalliste' : null,
  other_house_id: kind === 'direct' ? `other-${id}` : null,
  created_at: at(minute),
  ...extra,
});
const message = (id: string, channelId: string, houseId: string, minute: number): Message => ({
  id,
  channelId,
  houseId,
  body: id,
  createdAt: ms(minute),
  hidden: false,
});
const channel = (id: string, minute: number): Channel => ({
  id,
  kind: 'direct',
  worldId: 'w1',
  cityId: null,
  otherHouseId: 'x',
  createdAt: ms(minute),
});

function memoryStorage(): KeyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('canaux et messages lus', () => {
  it('le canal de la cité d’abord, puis les conversations des plus récentes aux plus anciennes, du monde de la cité seulement', () => {
    const rows = [
      channelRow('d-old', 'direct', 1),
      channelRow('city', 'city', 0),
      channelRow('d-new', 'direct', 5),
      channelRow('elsewhere', 'direct', 9, { world_id: 'w2' }),
      channelRow('other-city', 'city', 9, { world_id: 'w2', city_id: 'ailleurs' }),
    ];
    expect(parseChannels(rows, 'kalliste')?.map((c) => c.id)).toEqual(['city', 'd-new', 'd-old']);
    expect(parseChannels([...rows, { id: 'bad' }], 'kalliste')).toBeNull();
    // Sans canal de la cité, le monde n'est pas connu : rien n'est rendu plutôt qu'un autre monde.
    expect(parseChannels(rows.slice(2), 'kalliste')).toBeNull();
  });

  it('un message masqué reste listé, sans texte, même si une vue en rendait un ; ordre chronologique', () => {
    const rows = [
      {
        id: 'm2',
        channel_id: 'c',
        house_id: 'h',
        body: null,
        created_at: at(2),
        hidden_at: at(3),
      },
      {
        id: 'm1',
        channel_id: 'c',
        house_id: 'h',
        body: 'Khaire',
        created_at: at(1),
        hidden_at: null,
      },
      {
        id: 'm3',
        channel_id: 'c',
        house_id: 'h',
        body: 'fuite',
        created_at: at(4),
        hidden_at: at(4),
      },
    ];
    expect(parseMessages(rows)?.map((m) => [m.id, m.body, m.hidden])).toEqual([
      ['m1', 'Khaire', false],
      ['m2', null, true],
      ['m3', null, true],
    ]);
    expect(parseMessages([{ ...rows[0], created_at: 'hier' }])).toBeNull();
  });
});

describe('messages non lus, comptés sur l’appareil', () => {
  const channels = [channel('a', 0), channel('b', 2)];
  it('la lecture part de la plus ancienne marque, ou de la naissance d’un canal jamais ouvert', () => {
    expect(unreadSince(channels, {})).toBe(ms(0));
    expect(unreadSince(channels, { a: ms(7) })).toBe(ms(2));
    expect(unreadSince(channels, { a: ms(7), b: ms(5) })).toBe(ms(5));
    expect(unreadSince([], {})).toBeNull();
  });

  it('non lus : messages des autres maisons après la marque de leur canal', () => {
    const messages = [
      message('a1', 'a', 'other', 3),
      message('a2', 'a', 'me', 4),
      message('a3', 'a', 'other', 6),
      message('b1', 'b', 'other', 3),
      message('z1', 'unknown', 'other', 3),
    ];
    expect(Object.fromEntries(unreadCounts(channels, { a: ms(3) }, messages, 'me', 10))).toEqual({
      a: { count: 1, atLeast: false },
      b: { count: 1, atLeast: false },
    });
  });

  it('une lecture pleine : le compte d’un canal dont la marque précède le plus ancien message lu est un minimum', () => {
    const messages = [message('a1', 'a', 'other', 9), message('b1', 'b', 'other', 8)];
    expect(
      Object.fromEntries(unreadCounts(channels, { a: ms(8), b: ms(1) }, messages, 'me', 2)),
    ).toEqual({ a: { count: 1, atLeast: false }, b: { count: 1, atLeast: true } });
    expect(Object.fromEntries(unreadCounts(channels, {}, [], 'me', 2))).toEqual({
      a: { count: 0, atLeast: false },
      b: { count: 0, atLeast: false },
    });
  });

  it('une marque ne recule jamais, et se garde par maison', () => {
    const store = memoryStorage();
    expect(readMarks('h1', () => store)).toEqual({});
    markRead('h1', 'a', ms(5), () => store);
    markRead('h1', 'a', ms(3), () => store);
    markRead('h1', 'b', ms(1), () => store);
    expect(readMarks('h1', () => store)).toEqual({ a: ms(5), b: ms(1) });
    expect(readMarks('h2', () => store)).toEqual({});
  });

  it('stockage indisponible ou illisible : les marques restent en mémoire le temps de la page', () => {
    const broken = () => {
      throw new Error('SecurityError');
    };
    markRead('h3', 'a', ms(4), broken);
    expect(readMarks('h3', broken)).toEqual({ a: ms(4) });
    const store = memoryStorage();
    store.setItem('oikos.chat.read.h4', '{pas du json');
    expect(readMarks('h4', () => store)).toEqual({});
    store.setItem('oikos.chat.read.h4', JSON.stringify({ a: 'hier' }));
    expect(readMarks('h4', () => store)).toEqual({});
    expect(markRead('h4', 'a', ms(2), () => store)).toEqual({ a: ms(2) });
  });
});
