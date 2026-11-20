// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { CLIENT_SETTINGS } from '@oikos/config/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

// Onglet Messages (#274) : nouvelle conversation et annonces des messages reçus. Lectures, abonnements et commandes simulés.
const api = vi.hoisted(() => ({
  open: [] as { houseId: string; key: string; answer: (r: unknown) => void }[],
  lookups: [] as unknown[][],
}));
vi.mock('../api', () => ({
  openDirect: (houseId: string, _token: string, key: string) =>
    new Promise((answer) => api.open.push({ houseId, key, answer })),
}));
vi.mock('../supabase', async () => {
  const { fake } = await import('../chat-fake');
  return {
    supabase: {
      from: () => {
        const filters: unknown[] = [];
        const query = {
          select: () => query,
          eq: (...args: unknown[]) => (filters.push(args), query),
          ilike: (...args: unknown[]) => (filters.push(args), query),
          limit: () => query,
          then: (ok: (value: unknown) => unknown) => {
            api.lookups.push(filters);
            const name = String((filters[1] as unknown[])[1]).toLowerCase();
            const data = (fake.houses as { name: string }[]).filter(
              (row) => row.name.toLowerCase() === name,
            );
            return Promise.resolve(ok({ data }));
          },
        };
        return query;
      },
    },
  };
});
vi.mock('../data', async () => ({
  useRows: (await import('../chat-fake')).useFakeRows,
  useClockRules: () => ({ rules: null }),
}));
vi.mock('../chat-live', async () => ({
  chatTopics: (city: string | null, house: string) =>
    city === null ? null : [`chat:${city}`, `house:${house}`],
  useChatLive: (await import('../chat-fake')).useFakeChatLive,
}));
const { fake, channelRow, messageRow, resetFake } = await import('../chat-fake');
const { MessagesScreen } = await import('./Messages');

async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
      >
        <MessagesScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetFake();
  api.open.length = 0;
  api.lookups.length = 0;
});
afterEach(cleanup);
const box = () =>
  screen.getByRole('textbox', { name: /^Votre message dans/ }) as HTMLTextAreaElement;
const answer = async (call: { answer: (r: unknown) => void } | undefined, result: unknown) =>
  act(async () => call?.answer(result));
const statusText = () => screen.getAllByRole('status').map((node) => node.textContent);
const alerts = () => screen.getAllByRole('alert').map((node) => node.textContent);
const live = () => document.querySelector('[aria-live="polite"]')?.textContent;

describe('onglet Messages : nouvelle conversation (#274)', () => {
  // Le nom se saisit dans une feuille, ouverte par « Nouvelle conversation » si elle ne l'est pas.
  const name = () => {
    if (!screen.queryByRole('dialog'))
      fireEvent.click(screen.getByRole('button', { name: fr.messages.newConversationOpen }));
    return screen.getByRole('textbox', { name: fr.messages.newConversation });
  };
  const open = () => fireEvent.click(screen.getByRole('button', { name: fr.messages.open }));

  it('par le nom d’une maison du monde, sans tenir compte de la casse : la conversation s’ouvre et se montre', async () => {
    await show();
    fireEvent.change(name(), { target: { value: ' bacchiades ' } });
    open();
    await act(async () => undefined);
    expect(api.lookups).toEqual([
      [
        ['world_id', 'w1'],
        ['name', 'bacchiades'],
      ],
    ]);
    expect(api.open.map((call) => call.houseId)).toEqual(['h3']);
    fake.channels?.push(channelRow('dm2', 'direct', 'h3', 9));
    await answer(api.open[0], { ok: true, data: { channelId: 'dm2', houseId: 'h3' } });
    expect(statusText()).toContain('Conversation ouverte avec Bacchiades.');
    expect(
      screen
        .getAllByRole('button', { name: /^Conversation avec Bacchiades/ })[0]
        ?.getAttribute('aria-current'),
    ).toBe('true');
    // Ouverte, la feuille se ferme et le foyer passe au résultat ; rouverte, la saisie est vide.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Conversation ouverte avec Bacchiades.');
    expect((name() as HTMLInputElement).value).toBe('');
  });

  it('une maison inconnue, un nom impossible ou la maison elle-même sont refusés, dits sous la saisie', async () => {
    await show();
    fireEvent.change(name(), { target: { value: 'Inconnue' } });
    open();
    await act(async () => undefined);
    expect(alerts()).toContain(fr.messages.noSuchHouse);
    fireEvent.change(name(), { target: { value: '<script>' } });
    open();
    expect(api.lookups).toHaveLength(1);
    fireEvent.change(name(), { target: { value: 'Test' } });
    open();
    await act(async () => undefined);
    await answer(api.open[0], { ok: false, error: { code: 'SELF_CONVERSATION' } });
    expect(alerts()).toContain(fr.errors.SELF_CONVERSATION);
  });

  it('refusée, la recherche garde le foyer sur son bouton, jamais inactif pendant l’envoi', async () => {
    await show();
    fireEvent.change(name(), { target: { value: 'Bacchiades' } });
    const submit = screen.getByRole('button', { name: fr.messages.open });
    submit.focus();
    fireEvent.click(submit);
    await act(async () => undefined);
    // En vol : marqué inactif sans `disabled`, qui ferait tomber le foyer sur la page.
    expect([submit.hasAttribute('disabled'), submit.getAttribute('aria-disabled')]).toEqual([
      false,
      'true',
    ]);
    await answer(api.open[0], { ok: false, error: { code: 'INTERNAL' } });
    expect(alerts()).toContain(fr.errors.INTERNAL);
    expect(document.activeElement).toBe(submit);
  });
});

describe('onglet Messages : annonces (#274)', () => {
  it('un message reçu est annoncé poliment, sans voler le foyer de la saisie ; le sien ne l’est pas', async () => {
    await show();
    expect(live()).toBe('');
    box().focus();
    fake.messages.push(messageRow('m4', 'city', 'h3', 7), messageRow('m5', 'city', 'h1', 8));
    await act(async () => fake.signal());
    expect(live()).toBe('Nouveau message de Bacchiades : Texte m4');
    expect(document.activeElement).toBe(box());
    fake.messages.push(messageRow('d3', 'dm', 'h2', 9));
    await act(async () => fake.signal());
    expect(live()).toBe('Nouveau message : Conversation avec Philaïdes.');
    expect(document.activeElement).toBe(box());
  });

  it('une conversation ouverte par une maison jamais citée : l’annonce attend son nom', async () => {
    await show();
    fake.channels?.push(channelRow('dm4', 'direct', 'h4', 9));
    fake.messages.push(messageRow('e1', 'dm4', 'h4', 9));
    await act(async () => fake.signal());
    expect(live()).toBe('');
    fake.houses.push({ id: 'h4', name: 'Sosiades', citizenship_status: 'metic' });
    await act(async () => fake.signal());
    expect(live()).toBe('Nouveau message : Conversation avec Sosiades.');
  });

  it('un nom qui n’arrive pas : l’annonce part après l’intervalle de relecture, maison inconnue', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      await show();
      fake.channels?.push(channelRow('dm4', 'direct', 'h4', 9));
      fake.messages.push(messageRow('e1', 'dm4', 'h4', 9));
      await act(async () => fake.signal());
      act(() => vi.advanceTimersByTime(CLIENT_SETTINGS.chatPollSeconds * 1_000 - 1));
      expect(live()).toBe('');
      act(() => vi.advanceTimersByTime(1));
      expect(live()).toBe('Nouveau message : Conversation avec Maison inconnue.');
    } finally {
      vi.useRealTimers();
    }
  });
});
