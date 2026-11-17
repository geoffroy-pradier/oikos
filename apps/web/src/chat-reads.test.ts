// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from './house';

// Lectures de l'onglet Messages (#274), sur des lectures et des abonnements simulés.
vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./data', async () => ({ useRows: (await import('./chat-fake')).useFakeRows }));
vi.mock('./chat-live', async () => ({
  chatTopics: (city: string | null, house: string) =>
    city === null ? null : [`chat:${city}`, `house:${house}`],
  useChatLive: (await import('./chat-fake')).useFakeChatLive,
}));
const { fake, at, messageRow, resetFake } = await import('./chat-fake');
const { useChat } = await import('./chat-reads');
const { readMarks } = await import('./chat');

const house = {
  id: 'h1',
  name: 'Test',
  cityId: 'c1',
  accessToken: 't',
  cityName: 'Kallistè',
  cityNames: { c1: 'Kallistè' },
  citizenshipStatus: 'metic' as const,
};
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(HouseProvider, { value: house }, children);
const mount = () =>
  renderHook(({ selected }) => useChat(selected), {
    wrapper,
    initialProps: { selected: null as string | null },
  });
const counts = (unread: Map<string, { count: number; atLeast: boolean }> | null) =>
  unread && Object.fromEntries([...unread].map(([id, { count }]) => [id, count]));
let visibility: DocumentVisibilityState = 'visible';
beforeEach(() => {
  localStorage.clear();
  resetFake();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(cleanup);

describe('useChat : lectures de l’onglet Messages', () => {
  it('ouvre le canal de la cité, le marque lu sur l’appareil ; les messages des autres maisons ailleurs restent non lus', () => {
    const { result } = mount();
    expect(result.current.open?.id).toBe('city');
    expect(result.current.messages?.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(readMarks('h1')).toEqual({ city: Date.parse(at(4)) });
    expect(counts(result.current.unread)).toEqual({ city: 0, dm: 2 });
    expect(result.current.names?.get('h2')).toBe('Philaïdes');
    expect(fake.topics).toEqual(['chat:city', 'house:h1']);
  });

  it('une diffusion relit : un message arrivé dans le canal ouvert est lu, ailleurs il compte', async () => {
    const { result, rerender } = mount();
    rerender({ selected: 'dm' });
    expect(result.current.open?.id).toBe('dm');
    expect(readMarks('h1')).toMatchObject({ dm: Date.parse(at(6)) });
    fake.messages.push(messageRow('m4', 'city', 'h3', 7), messageRow('d3', 'dm', 'h2', 8));
    await act(async () => fake.signal());
    expect(result.current.messages?.map((m) => m.id)).toEqual(['d1', 'd2', 'd3']);
    expect(counts(result.current.unread)).toEqual({ city: 1, dm: 0 });
  });

  it('onglet caché : rien n’est marqué lu avant le retour sur l’onglet', async () => {
    visibility = 'hidden';
    const { result } = mount();
    expect(readMarks('h1')).toEqual({});
    expect(counts(result.current.unread)).toEqual({ city: 2, dm: 2 });
    visibility = 'visible';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(counts(result.current.unread)).toEqual({ city: 0, dm: 2 });
  });

  it('les non lus ne lisent que les canaux de la maison, hors ses propres messages', () => {
    fake.messages.push(messageRow('w2', 'autre-monde', 'h9', 9));
    const { result } = mount();
    const scan = fake.reads.filter(
      (read) => read.view === 'channel_messages' && read.filters && 'house_id' in read.filters,
    );
    expect(scan.at(-1)?.filters).toMatchObject({
      channel_id: ['city', 'dm'],
      house_id: { neq: 'h1' },
    });
    expect(counts(result.current.unread)).toEqual({ city: 0, dm: 2 });
  });

  it('relecture ciblée : la diffusion d’un canal relit les non lus, ses messages s’il est ouvert, la liste s’il est nouveau', async () => {
    mount();
    const views = () => [...fake.reloads].sort();
    fake.reloads = [];
    await act(async () => fake.signal('dm'));
    expect(views()).toEqual(['channel_messages:non-lus']);
    fake.reloads = [];
    await act(async () => fake.signal('city'));
    expect(views()).toEqual(['channel_messages:city', 'channel_messages:non-lus']);
    fake.reloads = [];
    await act(async () => fake.signal('conversation-nouvelle'));
    expect(views()).toEqual(['channel_messages:non-lus', 'my_channels:']);
    fake.reloads = [];
    await act(async () => fake.signal());
    expect(views()).toEqual(
      expect.arrayContaining(['channel_messages:city', 'channel_messages:non-lus', 'my_channels:']),
    );
  });

  it('une lecture en échec, ou sans canal de la cité, se dit en échec', () => {
    fake.channels = null;
    expect(mount().result.current.failed).toBe(true);
    resetFake();
    fake.channels = [];
    expect(mount().result.current).toMatchObject({ failed: true, channels: null });
  });
});
