import { CLIENT_SETTINGS } from '@oikos/config/client';
import { ArrowLeft, Badge, Button, ChevronRight, EmptyState, Landmark, Users } from '@oikos/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channel, Unread } from '../chat';
import { useChat } from '../chat-reads';
import { useHouse } from '../house';
import { useReports } from '../reports';
import { ScreenHeader } from '../ScreenHeader';
import { useWide } from '../wide';
import { STATUS_BOX } from './CommandNotice';
import { HouseLink } from './HouseLink';
import { LoadProblem, Loading } from './LoadProblem';
import { MessageComposer } from './MessageComposer';
import { NewConversation } from './NewConversation';
import { ReportMessage } from './ReportMessage';
import { dateTimeFormat } from '../game-time';

/**
 * Onglet Messages (6.6, #274) : le canal de la cité et les conversations privées de la maison, chacun avec ses
 * non lus, et les derniers messages du canal ouvert. Les messages arrivent par Realtime ; sans lui, l'écran
 * relit à intervalle régulier et le dit (ADR 0008). Sur ordinateur, deux panneaux : les canaux et le fil. Sur
 * téléphone, la liste des canaux, puis le fil du canal choisi, avec un retour à la liste (ADR 0011).
 */
export function MessagesScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const title = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Téléphone : la liste des canaux ou le fil ; un canal n'est lu que montré.
  const wide = useWide();
  const [pane, setPane] = useState<'list' | 'thread'>('list');
  const chat = useChat(selected, wide || pane === 'thread');
  const { channels, open, messages, unread, names } = chat;
  const reports = useReports();

  const nameOf = (houseId: string | null) =>
    houseId === house.id
      ? t('messages.you')
      : ((houseId && names?.get(houseId)) ?? t('cityPolitics.unknownHouse'));
  const channelName = (channel: Channel) =>
    channel.kind === 'city'
      ? t('messages.cityChannel', { city: house.cityName })
      : t('messages.direct', { house: nameOf(channel.otherHouseId) });
  const unreadText = (count: Unread | undefined) =>
    count && count.count > 0
      ? t(count.atLeast ? 'messages.unreadAtLeast' : 'messages.unread', { count: count.count })
      : null;
  const total = unread ? [...unread.values()].reduce((sum, count) => sum + count.count, 0) : 0;
  const atLeast = unread ? [...unread.values()].some((count) => count.atLeast) : false;
  const time = dateTimeFormat(i18n.language);

  // Message reçu annoncé poliment, sans déplacer le foyer (spécification 10, écran 8), hors première lecture
  // d'un canal ; une annonce qui nomme une maison attend son nom, au plus `chatPollSeconds` secondes.
  const [announcement, setAnnouncement] = useState({ n: 0, text: '' });
  const describe = useRef({ nameOf, channelName, t });
  describe.current = { nameOf, channelName, t };
  const seen = useRef<{ channel: string; ids: Set<string> } | null>(null);
  const counted = useRef<Map<string, number> | null>(null);
  const pending = useRef<{ houses: string[]; say: () => string }[]>([]);
  const deadline = useRef(0);
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    const { t: say } = describe.current;
    const events: { houses: string[]; say: () => string }[] = [];
    if (open && messages) {
      const before = seen.current;
      seen.current = { channel: open.id, ids: new Set(messages.map((message) => message.id)) };
      const fresh =
        before?.channel === open.id
          ? messages.filter(
              (message) => !before.ids.has(message.id) && message.houseId !== house.id,
            )
          : [];
      const [one] = fresh;
      if (fresh.length === 1 && one)
        events.push({
          houses: [one.houseId],
          say: () =>
            say('messages.arrived', {
              house: describe.current.nameOf(one.houseId),
              text: one.body ?? say('messages.hidden'),
            }),
        });
      else if (fresh.length > 1)
        events.push({
          houses: [],
          say: () => say('messages.arrivedMany', { count: fresh.length }),
        });
    }
    if (unread && channels) {
      const before = counted.current;
      counted.current = new Map([...unread].map(([id, count]) => [id, count.count]));
      for (const channel of channels)
        if (
          before &&
          channel.id !== open?.id &&
          (unread.get(channel.id)?.count ?? 0) > (before.get(channel.id) ?? 0)
        )
          events.push({
            houses: channel.otherHouseId ? [channel.otherHouseId] : [],
            say: () =>
              say('messages.arrivedIn', { channel: describe.current.channelName(channel) }),
          });
    }
    if (events.length > 0) {
      if (pending.current.length === 0)
        deadline.current = Date.now() + CLIENT_SETTINGS.chatPollSeconds * 1_000;
      pending.current.push(...events);
      setQueued((n) => n + 1);
    }
  }, [open, messages, unread, channels, house.id]);
  // Les noms lus, par leur liste : la carte des noms est neuve à chaque rendu.
  const known = names ? [...names.keys()].sort().join(',') : '';
  useEffect(() => {
    if (pending.current.length === 0) return;
    const flush = () => {
      const text = pending.current.map((event) => event.say()).join(' ');
      pending.current = [];
      setAnnouncement((last) => ({ n: last.n + 1, text }));
    };
    const ids = new Set(known.split(','));
    const named = (id: string) => id === house.id || ids.has(id);
    if (chat.failed || pending.current.every((event) => event.houses.every(named))) return flush();
    const timer = setTimeout(flush, Math.max(0, deadline.current - Date.now()));
    return () => clearTimeout(timer);
  }, [queued, known, chat.failed, house.id]);

  // Téléphone : le foyer suit le panneau montré, sur le titre du fil ou sur le canal quitté.
  const threadTitle = useRef<HTMLHeadingElement>(null);
  const channelButtons = useRef(new Map<string, HTMLButtonElement>());
  const moved = useRef(false);
  const where = useRef({ wide, openId: open?.id });
  where.current = { wide, openId: open?.id };
  useEffect(() => {
    const { wide, openId } = where.current;
    if (!moved.current || wide) return;
    if (pane === 'list') {
      if (openId) channelButtons.current.get(openId)?.focus();
      return;
    }
    // Le fil s'ouvre sur ses derniers messages, la saisie fixée en bas de l'écran.
    threadTitle.current?.focus({ preventScroll: true });
    const page = document.scrollingElement;
    page?.scrollTo?.({ top: page.scrollHeight });
  }, [pane]);
  const show = (next: 'list' | 'thread') => {
    moved.current = true;
    setPane(next);
  };
  // Le fil s'ouvre sur ses derniers messages, et les suit tant que le joueur est en bas.
  const thread = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  const shownCount = messages?.length ?? 0;
  useLayoutEffect(() => {
    const list = thread.current?.parentElement;
    if (list && atBottom.current) list.scrollTop = list.scrollHeight;
  }, [shownCount, open?.id]);
  useEffect(() => {
    atBottom.current = true;
  }, [open?.id]);
  // Conversation ouverte : annoncée sous l'en-tête, foyer sur l'annonce (la feuille et son bouton ont disparu).
  const [opened, setOpened] = useState({ n: 0, text: '' });
  const openedNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (opened.n > 0) openedNotice.current?.focus();
  }, [opened]);
  const totalText =
    total > 0 ? t(atLeast ? 'messages.unreadAtLeast' : 'messages.unread', { count: total }) : null;

  return (
    // Téléphone : l'écran remplit la fenêtre entre l'en-tête compact et la barre d'onglets, pour que la saisie
    // du fil reste collée en bas même quand le fil est court (#869) ; un fil long la garde par `sticky`.
    <div className="flex flex-col gap-4 max-lg:min-h-[calc(100dvh-11rem-env(safe-area-inset-bottom))]">
      <ScreenHeader
        title={t('tabs.messages.label')}
        titleRef={title}
        action={
          channels?.[0] && (
            <NewConversation
              worldId={channels[0].worldId}
              onOpened={async (channelId, other) => {
                setOpened((last) => ({
                  n: last.n + 1,
                  text: t('messages.opened', { house: other }),
                }));
                await chat.reload();
                setSelected(channelId);
                show('thread');
              }}
            />
          )
        }
      />
      <div aria-live="polite" className="sr-only">
        <p key={announcement.n}>{announcement.text}</p>
      </div>
      {/* Région présente avant son texte : le passage en relecture est annoncé poliment. */}
      <p role="status" className="rounded-lg bg-aegean-subtle p-3 text-aegean empty:sr-only">
        {chat.live === 'polling'
          ? t('messages.polling', { count: CLIENT_SETTINGS.chatPollSeconds })
          : ''}
      </p>
      <p ref={openedNotice} role="status" tabIndex={-1} className={STATUS_BOX}>
        {opened.text}
      </p>
      {chat.failed && <LoadProblem heading={title} onRetry={chat.reload} />}
      {channels === null && !chat.failed && <Loading />}
      {channels && (
        <div className="max-lg:flex max-lg:flex-1 max-lg:flex-col lg:grid lg:h-[calc(100dvh-12rem)] lg:min-h-[30rem] lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:overflow-hidden lg:rounded-xl lg:border lg:border-border-subtle lg:bg-surface lg:shadow-sm">
          <section
            aria-labelledby="channels-title"
            className={`flex min-h-0 flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-3 shadow-sm lg:rounded-none lg:border-0 lg:border-r lg:shadow-none ${pane === 'thread' ? 'max-lg:hidden' : ''}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1 pt-1">
              <h2 id="channels-title" className="text-lg">
                {t('messages.channels')}
              </h2>
              {totalText && <p className="text-sm font-medium text-primary">{totalText}</p>}
            </div>
            <ul className="flex flex-col gap-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {channels.map((channel) => {
                const count = unreadText(unread?.get(channel.id));
                const current = channel.id === open?.id;
                const Icon = channel.kind === 'city' ? Landmark : Users;
                return (
                  <li key={channel.id}>
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) channelButtons.current.set(channel.id, element);
                        else channelButtons.current.delete(channel.id);
                      }}
                      aria-current={current ? 'true' : undefined}
                      onClick={() => {
                        setSelected(channel.id);
                        show('thread');
                      }}
                      className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left wrap-anywhere transition-colors duration-(--motion-fast) hover:bg-muted ${current ? 'lg:bg-primary-subtle lg:font-semibold lg:text-primary' : ''}`}
                    >
                      <span
                        aria-hidden="true"
                        className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground-secondary"
                      >
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">{channelName(channel)}</span>
                      {count && (
                        <Badge tone="primary" className="whitespace-normal">
                          {count}
                        </Badge>
                      )}
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground lg:hidden"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          {open && (
            <section
              aria-labelledby="thread-title"
              className={`flex min-h-0 min-w-0 flex-col rounded-xl border border-border-subtle bg-surface shadow-sm max-lg:flex-1 lg:rounded-none lg:border-0 lg:shadow-none ${pane === 'list' ? 'max-lg:hidden' : ''}`}
            >
              <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5 lg:px-5 lg:py-3.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-1 shrink-0 lg:hidden"
                  icon={<ArrowLeft aria-hidden="true" />}
                  onClick={() => show('list')}
                >
                  {t('messages.channels')}
                  {totalText && (
                    <span className="sr-only">
                      {t('messages.backUnread', { unread: totalText })}
                    </span>
                  )}
                  {total > 0 && (
                    <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
                  )}
                </Button>
                <h2
                  id="thread-title"
                  ref={threadTitle}
                  tabIndex={-1}
                  className="min-w-0 text-lg wrap-anywhere"
                >
                  {channelName(open)}
                </h2>
              </div>
              <div
                className="flex flex-1 flex-col gap-3 p-3 lg:min-h-0 lg:overflow-y-auto lg:p-5"
                onScroll={(event) => {
                  const list = event.currentTarget;
                  atBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
                }}
              >
                {messages === null && !chat.failed && <Loading />}
                {messages?.length === 0 && (
                  <EmptyState
                    compact
                    illustration="noMessage"
                    className="m-auto"
                    title={t('messages.none')}
                  />
                )}
                {messages && messages.length > 0 && (
                  <ol
                    ref={thread}
                    className="flex flex-col gap-2.5"
                    aria-label={t('messages.list')}
                  >
                    {messages.map((message) => {
                      const mine = message.houseId === house.id;
                      return (
                        <li
                          key={message.id}
                          className={`flex max-w-[88%] flex-col gap-1 rounded-2xl px-3.5 py-2.5 sm:max-w-[75%] ${mine ? 'self-end rounded-br-md bg-primary-subtle' : 'self-start rounded-bl-md bg-muted'}`}
                        >
                          <p className="text-xs text-muted-foreground">
                            <HouseLink houseId={message.houseId}>
                              {nameOf(message.houseId)}
                            </HouseLink>{' '}
                            <time dateTime={new Date(message.createdAt).toISOString()}>
                              {time.format(message.createdAt)}
                            </time>
                          </p>
                          {message.hidden ? (
                            <p className="text-muted-foreground italic">{t('messages.hidden')}</p>
                          ) : (
                            <p className="break-words whitespace-pre-wrap">{message.body}</p>
                          )}
                          {/* Un message d'une autre maison, encore visible, se signale (#275). */}
                          {!mine &&
                            !message.hidden &&
                            reports.reasons &&
                            reports.reasons.length > 0 && (
                              <ReportMessage
                                messageId={message.id}
                                author={nameOf(message.houseId)}
                                reasons={reports.reasons}
                                reported={reports.reported?.has(message.id) ?? false}
                                onReported={reports.reload}
                              />
                            )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
              <MessageComposer
                key={open.id}
                channelId={open.id}
                label={t('messages.compose', { channel: channelName(open) })}
                onPosted={chat.reload}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
