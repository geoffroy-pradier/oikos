import { z } from 'zod';
import type { KeyStorage } from './pending-keys';

/**
 * Discussion (6.6, #273, #274) : canaux et messages lus par les vues `my_channels` et `channel_messages`, sous
 * règles par ligne, et messages non lus comptés sur l'appareil.
 */

/** Canal lisible : celui de la cité de la maison, ou une conversation privée avec `otherHouseId`. */
export interface Channel {
  id: string;
  kind: 'city' | 'direct';
  worldId: string;
  cityId: string | null;
  otherHouseId: string | null;
  createdAt: number;
}

/** Message lu ; `body` est nul pour un message masqué par la modération, qui reste listé. */
export interface Message {
  id: string;
  channelId: string;
  houseId: string;
  body: string | null;
  createdAt: number;
  hidden: boolean;
}

export const CHANNEL_COLUMNS = 'id, kind, world_id, city_id, other_house_id, created_at';
export const MESSAGE_COLUMNS = 'id, channel_id, house_id, body, created_at, hidden_at';

/**
 * Messages d'un canal affichés, les plus récents : un choix d'affichage, pas une règle du jeu (la conservation,
 * elle, est `chat.retentionDays`).
 */
export const SHOWN_MESSAGES = 50;
/**
 * Messages des autres maisons lus d'un coup pour compter les non lus, les plus récents d'abord. Au-delà, le
 * compte d'un canal plus ancien est un minimum (« 100 et plus »). Limite technique de la lecture.
 */
export const UNREAD_SCAN = 100;

const id = z.string().min(1);
const instant = z.string().transform((text, ctx) => {
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) ctx.addIssue({ code: 'custom', message: 'not an instant' });
  return ms;
});
const channelRow = z.object({
  id,
  kind: z.enum(['city', 'direct']),
  world_id: id,
  city_id: id.nullable(),
  other_house_id: id.nullable(),
  created_at: instant,
});
const messageRow = z.object({
  id,
  channel_id: id,
  house_id: id,
  body: z.string().nullable(),
  created_at: instant,
  hidden_at: instant.nullable(),
});

/**
 * Canaux du monde de la maison, le canal de sa cité d'abord, puis les conversations des plus récentes aux plus
 * anciennes. Le monde est celui du canal de la cité de la maison : un compte peut avoir une maison dans un
 * autre monde, dont les canaux sont écartés. `null` si une ligne est illisible ou si le canal de la cité manque.
 */
export function parseChannels(rows: unknown, cityId: string): Channel[] | null {
  const parsed = z.array(channelRow).safeParse(rows);
  if (!parsed.success) return null;
  const city = parsed.data.find((row) => row.kind === 'city' && row.city_id === cityId);
  if (!city) return null;
  const channels = parsed.data
    .filter((row) => row.world_id === city.world_id && (row.kind === 'direct' || row === city))
    .map((row): Channel => ({
      id: row.id,
      kind: row.kind,
      worldId: row.world_id,
      cityId: row.city_id,
      otherHouseId: row.other_house_id,
      createdAt: row.created_at,
    }));
  return channels.sort(
    (a, b) =>
      Number(b.kind === 'city') - Number(a.kind === 'city') ||
      b.createdAt - a.createdAt ||
      a.id.localeCompare(b.id),
  );
}

/** Messages lus, des plus anciens aux plus récents ; `null` si une ligne est illisible. */
export function parseMessages(rows: unknown): Message[] | null {
  const parsed = z.array(messageRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .map((row): Message => ({
      id: row.id,
      channelId: row.channel_id,
      houseId: row.house_id,
      body: row.hidden_at === null ? row.body : null,
      createdAt: row.created_at,
      hidden: row.hidden_at !== null,
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Non lus d'un canal ; `atLeast` : le compte est un minimum, la lecture n'est pas remontée assez loin. */
export interface Unread {
  count: number;
  atLeast: boolean;
}

/**
 * Lu jusqu'à : instant du dernier message lu de chaque canal, en millisecondes. Un canal sans marque n'a
 * jamais été ouvert sur cet appareil : tous ses messages sont non lus.
 */
export type ReadMarks = Readonly<Record<string, number>>;

/**
 * Borne de la lecture des non lus : la plus ancienne marque des canaux, ou la naissance d'un canal sans marque.
 * `null` sans canal.
 */
export function unreadSince(channels: readonly Channel[], marks: ReadMarks): number | null {
  const bounds = channels.map((channel) => marks[channel.id] ?? channel.createdAt);
  return bounds.length === 0 ? null : Math.min(...bounds);
}

/**
 * Non lus par canal, d'après les messages des autres maisons lus depuis `unreadSince` (au plus `scanned`, les
 * plus récents). Un message est non lu s'il est postérieur à la marque de son canal. Si la lecture a rendu
 * autant de messages qu'elle en demandait, un canal dont la marque est plus ancienne que le plus ancien message
 * lu peut en avoir davantage : son compte est un minimum.
 */
export function unreadCounts(
  channels: readonly Channel[],
  marks: ReadMarks,
  messages: readonly Message[],
  houseId: string,
  scanned: number,
): Map<string, Unread> {
  const full = messages.length >= scanned;
  const oldest = Math.min(...messages.map((message) => message.createdAt));
  const counts = new Map<string, Unread>();
  for (const channel of channels) {
    const mark = marks[channel.id] ?? Number.NEGATIVE_INFINITY;
    const count = messages.filter(
      (message) =>
        message.channelId === channel.id && message.houseId !== houseId && message.createdAt > mark,
    ).length;
    counts.set(channel.id, { count, atLeast: full && mark < oldest });
  }
  return counts;
}

/**
 * Marques de lecture d'une maison sur cet appareil (stockage local). Un stockage indisponible (navigation
 * privée, stockage plein ou refusé) les garde en mémoire, le temps de la page : les non lus ne sont alors pas
 * retenus d'une visite à l'autre.
 */
const memory = new Map<string, Record<string, number>>();
const marksKey = (houseId: string) => `oikos.chat.read.${houseId}`;
const safe = <T>(storage: () => KeyStorage | undefined, action: (store: KeyStorage) => T) => {
  try {
    const store = storage();
    return store ? action(store) : undefined;
  } catch {
    return undefined;
  }
};
const localStore = () => window.localStorage;

export function readMarks(houseId: string, storage: () => KeyStorage | undefined = localStore) {
  // `null` : rien de rangé ; `undefined` : stockage indisponible, les marques de la mémoire font foi.
  const stored = safe(storage, (store) => store.getItem(marksKey(houseId)));
  if (stored === undefined) return { ...memory.get(houseId) } as ReadMarks;
  try {
    const parsed = z.record(z.string(), z.number()).safeParse(JSON.parse(stored ?? '{}'));
    return (parsed.success ? parsed.data : {}) as ReadMarks;
  } catch {
    // Valeur illisible : aucune marque, tous les messages sont non lus.
    return {};
  }
}

/** Le canal est lu jusqu'à `at` ; une marque ne recule jamais. Rend les marques à jour. */
export function markRead(
  houseId: string,
  channelId: string,
  at: number,
  storage: () => KeyStorage | undefined = localStore,
): ReadMarks {
  const marks = { ...readMarks(houseId, storage) };
  if ((marks[channelId] ?? Number.NEGATIVE_INFINITY) >= at) return marks;
  marks[channelId] = at;
  const kept = safe(
    storage,
    (store) => (store.setItem(marksKey(houseId), JSON.stringify(marks)), true),
  );
  if (kept) memory.delete(houseId);
  else memory.set(houseId, marks);
  return marks;
}
