import { CLIENT_SETTINGS } from '@oikos/config/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CHANNEL_COLUMNS,
  MESSAGE_COLUMNS,
  parseChannels,
  parseMessages,
  readMarks,
  UNREAD_SCAN,
  unreadCounts,
  unreadSince,
  type Unread,
} from './chat';
import { CITED_HOUSES_PER_READ } from './cited-houses';
import { useRows } from './data';
import { useHouse } from './house';

/** Annoncé par l'onglet Messages quand il marque un canal lu : la pastille de la navigation se met à jour. */
export const CHAT_READ_EVENT = 'oikos:chat-read';

/** Total des non lus de tous les canaux ; `atLeast` si l'un des comptes est un minimum. */
export function unreadTotal(counts: ReadonlyMap<string, Unread>): Unread {
  const all = [...counts.values()];
  return {
    count: all.reduce((sum, unread) => sum + unread.count, 0),
    atLeast: all.some((unread) => unread.atLeast),
  };
}

/**
 * Non lus de la maison, tous canaux confondus, pour la pastille de l'onglet Messages, comptés comme l'onglet
 * (`useChat`) sans rien marquer lu. Sans abonnement Realtime, qui reste à l'onglet : relus à chaque changement
 * d'écran (`pathname`), au retour sur l'onglet du navigateur, à intervalle (`chatSafetyRereadSeconds`) et quand
 * l'onglet Messages marque un canal lu. Le dernier total reste affiché pendant une relecture.
 */
export function useUnreadTotal(pathname: string): Unread | null {
  const house = useHouse();
  const channelRead = useRows<unknown>('my_channels', CHANNEL_COLUMNS, 'created_at');
  const channels = useMemo(
    () => (channelRead.rows === null ? null : parseChannels(channelRead.rows, house.cityId)),
    [channelRead.rows, house.cityId],
  );
  const [marks, setMarks] = useState(() => readMarks(house.id));
  const since = channels ? unreadSince(channels, marks) : null;
  const ids = channels?.map((channel) => channel.id) ?? [];
  const scanRead = useRows<unknown>(
    'channel_messages',
    MESSAGE_COLUMNS,
    'created_at',
    since === null
      ? null
      : {
          ...(ids.length <= CITED_HOUSES_PER_READ ? { channel_id: ids } : {}),
          house_id: { neq: house.id },
          created_at: { gt: new Date(since).toISOString() },
        },
    { limit: UNREAD_SCAN },
  );
  const scanned = scanRead.rows === null ? null : parseMessages(scanRead.rows);
  const total =
    channels && scanned
      ? unreadTotal(unreadCounts(channels, marks, scanned, house.id, UNREAD_SCAN))
      : null;
  const last = useRef<Unread | null>(null);
  if (total) last.current = total;

  const reloads = useRef(() => Promise.all([channelRead.reload(), scanRead.reload()]));
  reloads.current = () => Promise.all([channelRead.reload(), scanRead.reload()]);
  const first = useRef(true);
  useEffect(() => {
    // Au montage, les lectures partent d'elles-mêmes : seuls les changements d'écran relisent.
    if (first.current) {
      first.current = false;
      return;
    }
    setMarks(readMarks(house.id));
    void reloads.current();
  }, [pathname, house.id]);
  useEffect(() => {
    const refresh = () => {
      setMarks(readMarks(house.id));
      if (document.visibilityState === 'visible') void reloads.current();
    };
    const marked = () => setMarks(readMarks(house.id));
    const timer = setInterval(refresh, CLIENT_SETTINGS.chatSafetyRereadSeconds * 1000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(CHAT_READ_EVENT, marked);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(CHAT_READ_EVENT, marked);
    };
  }, [house.id]);
  return total ?? last.current;
}
