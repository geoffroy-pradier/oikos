// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

// Onglet Messages (#274) : saisie d'un message. Lectures, abonnements et commande simulés.
const api = vi.hoisted(() => ({
  post: [] as { channelId: string; body: string; key: string; answer: (r: unknown) => void }[],
}));
vi.mock('../api', () => ({
  postMessage: (channelId: string, body: string, _token: string, key: string) =>
    new Promise((answer) => api.post.push({ channelId, body, key, answer })),
}));
vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('../data', async () => ({ useRows: (await import('../chat-fake')).useFakeRows }));
vi.mock('../chat-live', async () => ({
  chatTopics: (city: string | null, house: string) =>
    city === null ? null : [`chat:${city}`, `house:${house}`],
  useChatLive: (await import('../chat-fake')).useFakeChatLive,
}));
const { fake, messageRow, resetFake } = await import('../chat-fake');
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
  api.post.length = 0;
});
afterEach(cleanup);
const box = () =>
  screen.getByRole('textbox', { name: /^Votre message dans/ }) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
const answer = async (call: { answer: (r: unknown) => void } | undefined, result: unknown) =>
  act(async () => call?.answer(result));
const posted = (n: number) => ({ ok: true, data: { messageId: `p${n}` }, replayed: false });
const statusText = () => screen.getAllByRole('status').map((node) => node.textContent);
const alerts = () => screen.getAllByRole('alert').map((node) => node.textContent);

describe('onglet Messages : saisie (#274)', () => {
  it('le brouillon survit au changement de canal et aux messages reçus ; envoyé, il s’efface et le foyer reste', async () => {
    await show();
    type('Brouillon de la cité');
    fireEvent.click(screen.getByRole('button', { name: /^Conversation avec Philaïdes/ }));
    expect(box().value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /^Canal de Kallistè/ }));
    expect(box().value).toBe('Brouillon de la cité');
    fake.messages.push(messageRow('m4', 'city', 'h3', 7));
    await act(async () => fake.signal());
    expect(box().value).toBe('Brouillon de la cité');
    box().focus();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(api.post.map(({ channelId, body }) => [channelId, body])).toEqual([
      ['city', 'Brouillon de la cité'],
    ]);
    await answer(api.post[0], posted(1));
    expect(box().value).toBe('');
    expect(statusText()).toContain('Message envoyé.');
    expect(document.activeElement).toBe(box());
    expect(sessionStorage.getItem('oikos.chat.draft.h1.city')).toBeNull();
  });

  it('refusé ou sans réponse, le texte reste ; la même saisie repart sous la même clé, une autre sous une neuve', async () => {
    await show();
    type('  Khaire  ');
    send();
    await answer(api.post[0], { ok: false, error: { code: 'INTERNAL' } });
    expect(box().value).toBe('  Khaire  ');
    expect(alerts()).toContain(fr.errors.INTERNAL);
    send();
    expect(api.post[1]?.key).toBe(api.post[0]?.key);
    expect(api.post[1]?.body).toBe('Khaire');
    await answer(api.post[1], { ok: false, error: { code: 'TOO_MANY_MESSAGES' } });
    expect(alerts()).toContain(fr.errors.TOO_MANY_MESSAGES);
    expect(box().value).toBe('  Khaire  ');
    send();
    expect(api.post[2]?.key).not.toBe(api.post[0]?.key);
    // Modifié pendant l'envoi : la saisie nouvelle n'est pas effacée par la réponse.
    type('Khaire, et la suite');
    await answer(api.post[2], posted(2));
    expect(box().value).toBe('Khaire, et la suite');
    type('Autre texte');
    send();
    expect(new Set(api.post.map((call) => call.key)).size).toBe(3);
  });

  it('sans stockage de session, le brouillon reste en mémoire au changement de canal ; Cmd+Entrée envoie aussi', async () => {
    const storage = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      await show();
      expect(screen.getByText(fr.messages.sendHint)).toBeTruthy();
      expect(fr.messages.sendHint).toMatch(/Cmd\+Entrée/);
      expect(en.messages.sendHint).toMatch(/Cmd\+Enter/);
      type('Brouillon sans stockage');
      fireEvent.click(screen.getByRole('button', { name: /^Conversation avec Philaïdes/ }));
      expect(box().value).toBe('');
      fireEvent.click(screen.getByRole('button', { name: /^Canal de Kallistè/ }));
      expect(box().value).toBe('Brouillon sans stockage');
      fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
      expect(api.post.map((call) => call.body)).toEqual(['Brouillon sans stockage']);
      await answer(api.post[0], posted(3));
      expect(box().value).toBe('');
    } finally {
      storage.mockRestore();
    }
  });

  it('un message vide ou blanc n’est pas envoyé', async () => {
    await show();
    type('   ');
    send();
    expect(api.post).toEqual([]);
    expect(alerts()).toContain(fr.messages.invalid);
  });
});
