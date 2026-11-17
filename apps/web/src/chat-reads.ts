import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CHANNEL_COLUMNS,
  markRead,
  MESSAGE_COLUMNS,
  parseChannels,
  parseMessages,
  readMarks,
  SHOWN_MESSAGES,
  UNREAD_SCAN,
  unreadCounts,
  unreadSince,
} from './chat';
import { chatTopics, useChatLive } from './chat-live';
import { CITED_HOUSES_PER_READ, useCitedHouses } from './cited-houses';
import { useRows } from './data';
import { useHouse } from './house';

/**
 * Lectures de l'onglet Messages : canaux du monde de la maison, derniers messages du canal ouvert (celui de la
 * cité par défaut), non lus comptés sur l'appareil, noms des maisons citées, et abonnements Realtime qui
 * relisent le tout à chaque diffusion (ou à intervalle, en repli). Le canal ouvert est marqué lu jusqu'à son
 * dernier message tant que l'onglet est visible.
 */
export function useChat(selectedId: string | null) {
  const house = useHouse();
  const channelRead = useRows<unknown>('my_channels', CHANNEL_COLUMNS, 'created_at');
  const channels = useMemo(
    () => (channelRead.rows === null ? null : parseChannels(channelRead.rows, house.cityId)),
    [channelRead.rows, house.cityId],
  );
  const city = channels?.find((channel) => channel.kind === 'city') ?? null;
  const open = channels?.find((channel) => channel.id === selectedId) ?? city;
  const messageRead = useRows<unknown>(
    'channel_messages',
    MESSAGE_COLUMNS,
    'created_at',
    open ? { channel_id: open.id } : null,
    { limit: SHOWN_MESSAGES },
  );
  const messages = useMemo(
    () => (messageRead.rows === null ? null : parseMessages(messageRead.rows)),
    [messageRead.rows],
  );

  // Non lus : la borne de lecture est fixée quand la liste des canaux change, pas à chaque marque, pour que
  // la lecture ne reparte pas à chaque message lu ; les comptes, eux, suivent les marques.
  const [marks, setMarks] = useState(() => readMarks(house.id));
  const [since, setSince] = useState<number | null>(null);
  const channelKey = channels?.map((channel) => channel.id).join(',') ?? null;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  useEffect(() => {
    if (channelKey === null || !channelsRef.current) return;
    setSince(unreadSince(channelsRef.current, readMarks(house.id)));
  }, [channelKey, house.id]);
  // Non lus des seuls canaux de la maison (pas ceux d'un autre monde du compte), nommés dans l'adresse comme les
  // maisons citées ; au-delà, tous les canaux lisibles, et un compte peut n'être qu'un minimum.
  const channelIds = useMemo(
    () => (channelKey === null || channelKey === '' ? null : channelKey.split(',')),
    [channelKey],
  );
  const scanRead = useRows<unknown>(
    'channel_messages',
    MESSAGE_COLUMNS,
    'created_at',
    since === null || channelIds === null
      ? null
      : {
          ...(channelIds.length <= CITED_HOUSES_PER_READ ? { channel_id: channelIds } : {}),
          house_id: { neq: house.id },
          created_at: { gt: new Date(since).toISOString() },
        },
    { limit: UNREAD_SCAN },
  );
  const scanned = useMemo(
    () => (scanRead.rows === null ? null : parseMessages(scanRead.rows)),
    [scanRead.rows],
  );
  const unread = useMemo(
    () =>
      channels && scanned ? unreadCounts(channels, marks, scanned, house.id, UNREAD_SCAN) : null,
    [channels, scanned, marks, house.id],
  );

  // Lu jusqu'au dernier message du canal ouvert ; les marques ne changent que si elles avancent.
  const newest = messages?.at(-1);
  const openId = open?.id;
  const newestAt = newest && newest.channelId === openId ? newest.createdAt : null;
  useEffect(() => {
    if (!openId || newestAt === null) return;
    const mark = () => {
      if (document.visibilityState !== 'visible') return;
      const next = markRead(house.id, openId, newestAt);
      setMarks((before) => (before[openId] === next[openId] ? before : next));
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [openId, newestAt, house.id]);

  const names = useCitedHouses(
    channels === null
      ? null
      : [
          ...channels.map((channel) => channel.otherHouseId ?? undefined),
          ...(messages ?? []).map((message) => message.houseId),
        ],
  );

  const reads = [channelRead, messageRead, scanRead];
  const reload = () => Promise.all([...reads, names].map((read) => read.reload()));
  // Relecture ciblée : une diffusion nomme son canal. Les non lus sont relus à chaque fois ; les messages, si
  // c'est le canal ouvert ; la liste des canaux, si le canal est inconnu (conversation nouvelle). Les noms
  // suivent les maisons citées. Sans canal nommé (relecture de repli, de sécurité, retour sur l'onglet,
  // abonnement établi) : tout est relu.
  const signal = (channelId?: string) => {
    if (channelId === undefined) return reload();
    const known = channels?.some((channel) => channel.id === channelId) ?? false;
    return Promise.all([
      scanRead.reload(),
      ...(channelId === open?.id ? [messageRead.reload()] : []),
      ...(known ? [] : [channelRead.reload()]),
    ]);
  };
  const signalRef = useRef(signal);
  signalRef.current = signal;
  const live = useChatLive(chatTopics(city?.id ?? null, house.id), (channelId) => {
    void signalRef.current(channelId);
  });

  const failed =
    reads.some((read) => read.failed) ||
    names.failed ||
    (channelRead.rows !== null && channels === null) ||
    (messageRead.rows !== null && messages === null);
  return {
    channels,
    open: open ?? null,
    messages: messages?.every((message) => message.channelId === open?.id) ? messages : null,
    unread,
    names: names.names,
    live,
    failed,
    reload,
  };
}
