// @vitest-environment jsdom
import { CLIENT_SETTINGS } from '@oikos/config/client';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Client Realtime simulé : chaque abonnement garde ses options, son écouteur et son rappel d'état, que le test
// déclenche lui-même.
interface FakeChannel {
  name: string;
  options: unknown;
  filters: unknown[];
  emit: (payload?: unknown, event?: string) => void;
  status: (status: string) => void;
  removed: boolean;
}
const channels = vi.hoisted(() => [] as FakeChannel[]);
vi.mock('./supabase', () => ({
  supabase: {
    channel: (name: string, options: unknown) => {
      const channel: FakeChannel = {
        name,
        options,
        filters: [],
        emit: () => undefined,
        status: () => undefined,
        removed: false,
      };
      channels.push(channel);
      const api = {
        on: (
          _type: string,
          filter: { event: string },
          callback: (message: { payload?: unknown }) => void,
        ) => {
          channel.filters.push(filter);
          const previous = channel.emit;
          // Comme Realtime : seul l'écouteur de l'événement émis est appelé (message_posted par défaut).
          channel.emit = (payload, event = 'message_posted') => {
            previous(payload, event);
            if (event === filter.event) callback({ payload });
          };
          return api;
        },
        subscribe: (callback: (status: string) => void) => {
          channel.status = callback;
          return api;
        },
        channel,
      };
      return api;
    },
    removeChannel: (api: { channel: FakeChannel }) => {
      api.channel.removed = true;
      // Comme Realtime : le canal retiré se dit fermé.
      api.channel.status('CLOSED');
      return Promise.resolve('ok');
    },
  },
}));
const { chatTopics, useChatLive } = await import('./chat-live');

const POLL_MS = CLIENT_SETTINGS.chatPollSeconds * 1_000;
const SAFETY_MS = CLIENT_SETTINGS.chatSafetyRereadSeconds * 1_000;
let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
};
beforeEach(() => {
  vi.useFakeTimers();
  channels.length = 0;
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const TOPICS = chatTopics('city-1', 'house-1');
const mount = (topics: readonly string[] | null = TOPICS) => {
  const onSignal = vi.fn();
  const hook = renderHook(({ names }) => useChatLive(names, onSignal), {
    initialProps: { names: topics },
  });
  return { onSignal, hook };
};
/** Laisse partir les abonnements, ouverts après les retraits en cours. */
const settle = () => act(async () => void (await Promise.resolve()));
const statusAll = (status: string) =>
  act(() => {
    for (const channel of channels.filter((c) => !c.removed)) channel.status(status);
  });

describe('useChatLive : messages en direct, relecture de repli (ADR 0008)', () => {
  it('écoute le canal de la cité et la maison, en canaux privés, et relit à chaque diffusion', async () => {
    expect(TOPICS).toEqual(['chat:city-1', 'house:house-1']);
    expect(chatTopics(null, 'house-1')).toBeNull();
    const { onSignal, hook } = mount();
    await settle();
    expect(channels.map((c) => [c.name, c.options, c.filters])).toEqual([
      [
        'chat:city-1',
        { config: { private: true } },
        [{ event: 'message_posted' }, { event: 'message_hidden' }],
      ],
      [
        'house:house-1',
        { config: { private: true } },
        [{ event: 'message_posted' }, { event: 'message_hidden' }],
      ],
    ]);
    expect(hook.result.current).toBe('connecting');
    await statusAll('SUBSCRIBED');
    expect(hook.result.current).toBe('live');
    onSignal.mockClear();
    // Chaque diffusion relit, en nommant le canal diffusé ; une diffusion illisible fait tout relire.
    act(() => channels[1]?.emit({ channel_id: 'dm-1', message_id: 'm' }));
    act(() => channels[0]?.emit({ channel_id: 42 }));
    expect(onSignal.mock.calls).toEqual([['dm-1'], [undefined]]);
  });

  it('le masquage diffusé relit le canal nommé, comme un message écrit (#532)', async () => {
    const { onSignal } = mount();
    await settle();
    await statusAll('SUBSCRIBED');
    onSignal.mockClear();
    act(() => channels[0]?.emit({ channel_id: 'city-1', message_id: 'm' }, 'message_hidden'));
    act(() => channels[1]?.emit({ channel_id: 'dm-1', message_id: 'm' }, 'message_hidden'));
    // Un seul appel par diffusion, malgré les deux écouteurs du canal.
    expect(onSignal.mock.calls).toEqual([['city-1'], ['dm-1']]);
  });

  it('un message validé entre la première lecture et l’abonnement est relu dès que tous les abonnements sont établis', async () => {
    const { onSignal } = mount();
    await settle();
    act(() => channels[0]?.status('SUBSCRIBED'));
    expect(onSignal).not.toHaveBeenCalled();
    act(() => channels[1]?.status('SUBSCRIBED'));
    expect(onSignal.mock.calls).toEqual([[]]);
    // Un statut répété ne relit pas de nouveau.
    act(() => channels[1]?.status('SUBSCRIBED'));
    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it('en direct, une relecture de sécurité lente, onglet visible, et aucune relecture de repli', async () => {
    const { onSignal } = mount();
    await settle();
    await statusAll('SUBSCRIBED');
    onSignal.mockClear();
    expect(SAFETY_MS).toBeGreaterThan(POLL_MS);
    act(() => vi.advanceTimersByTime(SAFETY_MS - 1));
    expect(onSignal).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onSignal.mock.calls).toEqual([[]]);
    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(SAFETY_MS * 2));
    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it('un abonnement refusé : relecture à intervalle tant que l’onglet est visible, rattrapage au retour du direct', async () => {
    const { onSignal, hook } = mount();
    await settle();
    act(() => channels[0]?.status('SUBSCRIBED'));
    act(() => channels[1]?.status('CHANNEL_ERROR'));
    expect(hook.result.current).toBe('polling');
    act(() => vi.advanceTimersByTime(POLL_MS));
    expect(onSignal).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(POLL_MS));
    expect(onSignal).toHaveBeenCalledTimes(2);
    // Onglet caché : rien ne part ; au retour, une relecture tout de suite.
    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(POLL_MS * 3));
    expect(onSignal).toHaveBeenCalledTimes(2);
    act(() => setVisibility('visible'));
    expect(onSignal).toHaveBeenCalledTimes(3);
    // Le direct revient : une relecture rattrape la panne, puis plus de relecture à intervalle.
    act(() => channels[1]?.status('SUBSCRIBED'));
    expect(hook.result.current).toBe('live');
    expect(onSignal).toHaveBeenCalledTimes(4);
    act(() => vi.advanceTimersByTime(POLL_MS * 2));
    expect(onSignal).toHaveBeenCalledTimes(4);
    // Coupé de nouveau (expiration, fermeture) : relecture de nouveau.
    act(() => channels[0]?.status('TIMED_OUT'));
    expect(hook.result.current).toBe('polling');
    act(() => vi.advanceTimersByTime(POLL_MS));
    expect(onSignal).toHaveBeenCalledTimes(5);
  });

  it('Realtime sans réponse : à la première échéance, l’écran passe en relecture', async () => {
    const { onSignal, hook } = mount();
    await settle();
    act(() => vi.advanceTimersByTime(POLL_MS - 1));
    expect(hook.result.current).toBe('connecting');
    expect(onSignal).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(hook.result.current).toBe('polling');
    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it('sujets changés ou écran quitté : les abonnements sont retirés, et leurs signaux ignorés', async () => {
    const { onSignal, hook } = mount();
    await settle();
    const first = [...channels];
    hook.rerender({ names: chatTopics('city-2', 'house-1') });
    expect(first.every((c) => c.removed)).toBe(true);
    act(() => first[0]?.emit());
    expect(onSignal).not.toHaveBeenCalled();
    expect(hook.result.current).toBe('connecting');
    // Le sujet de la maison, retiré, est rouvert une fois son retrait fini.
    await settle();
    expect(channels.slice(2).map((c) => c.name)).toEqual(['chat:city-2', 'house:house-1']);
    hook.unmount();
    expect(channels.every((c) => c.removed)).toBe(true);
    act(() => vi.advanceTimersByTime(POLL_MS * 3));
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('sans sujets connus, rien n’est écouté ni relu', async () => {
    const { onSignal, hook } = mount(null);
    await settle();
    act(() => vi.advanceTimersByTime(POLL_MS * 3));
    expect(channels).toEqual([]);
    expect(onSignal).not.toHaveBeenCalled();
    expect(hook.result.current).toBe('connecting');
  });
});
