import { CLIENT_SETTINGS } from '@oikos/config/client';
import { Card } from '@oikos/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channel, Unread } from '../chat';
import { useChat } from '../chat-reads';
import { useHouse } from '../house';
import { LoadProblem, Loading } from './LoadProblem';
import { MessageComposer } from './MessageComposer';

/**
 * Onglet Messages (6.6, #274) : le canal de la cité et les conversations privées de la maison, chacun avec ses
 * non lus, et les derniers messages du canal ouvert. Les messages arrivent par Realtime ; sans lui, l'écran
 * relit à intervalle régulier et le dit (ADR 0008).
 */
export function MessagesScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const title = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const chat = useChat(selected);
  const { channels, open, messages, unread, names } = chat;

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
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="flex flex-col gap-4">
      <h1 ref={title} tabIndex={-1} className="text-2xl">
        {t('tabs.messages.label')}
      </h1>
      {/* Région présente avant son texte : le passage en relecture est annoncé poliment. */}
      <p role="status" className="text-muted-foreground empty:hidden">
        {chat.live === 'polling'
          ? t('messages.polling', { count: CLIENT_SETTINGS.chatPollSeconds })
          : ''}
      </p>
      {chat.failed && <LoadProblem heading={title} onRetry={chat.reload} />}
      {channels === null && !chat.failed && <Loading />}
      {channels && (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[18rem_1fr] lg:items-start">
          <Card className="flex flex-col gap-2">
            <h2 className="text-xl">{t('messages.channels')}</h2>
            {total > 0 && (
              <p>{t(atLeast ? 'messages.unreadAtLeast' : 'messages.unread', { count: total })}</p>
            )}
            <ul className="flex flex-col gap-1">
              {channels.map((channel) => {
                const count = unreadText(unread?.get(channel.id));
                const current = channel.id === open?.id;
                return (
                  <li key={channel.id}>
                    <button
                      type="button"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => setSelected(channel.id)}
                      className={`flex min-h-11 w-full flex-wrap items-center justify-between gap-x-2 rounded-md px-3 py-2 text-left wrap-anywhere hover:bg-muted ${current ? 'font-bold underline underline-offset-4' : ''}`}
                    >
                      <span>{channelName(channel)}</span>
                      {count && <span className="text-sm">{count}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          {open && (
            <Card className="flex min-w-0 flex-col gap-3">
              <h2 className="text-xl wrap-anywhere">{channelName(open)}</h2>
              {messages === null && !chat.failed && <Loading />}
              {messages?.length === 0 && (
                <p className="text-muted-foreground">{t('messages.none')}</p>
              )}
              {messages && messages.length > 0 && (
                <ol className="flex flex-col gap-2" aria-label={t('messages.list')}>
                  {messages.map((message) => (
                    <li key={message.id} className="flex flex-col border-t border-border pt-2">
                      <p className="text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {nameOf(message.houseId)}
                        </span>{' '}
                        <time dateTime={new Date(message.createdAt).toISOString()}>
                          {time.format(message.createdAt)}
                        </time>
                      </p>
                      {message.hidden ? (
                        <p className="text-muted-foreground italic">{t('messages.hidden')}</p>
                      ) : (
                        <p className="break-words whitespace-pre-wrap">{message.body}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              <MessageComposer
                key={open.id}
                channelId={open.id}
                label={t('messages.compose', { channel: channelName(open) })}
                onPosted={chat.reload}
              />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
