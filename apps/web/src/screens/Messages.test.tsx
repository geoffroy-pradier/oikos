// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

// Onglet Messages (#274) : lectures et abonnements simulés (`chat-fake.ts`).
vi.mock('../supabase', () => ({ supabase: {} }));
// Un intervalle de relecture réglé autrement que la valeur livrée : l'écran dit celui de la configuration.
vi.mock('@oikos/config/client', () => ({
  CLIENT_SETTINGS: { updateCheckMinutes: 60, chatPollSeconds: 42, chatSafetyRereadSeconds: 120 },
}));
vi.mock('../data', async () => ({
  useRows: (await import('../chat-fake')).useFakeRows,
  useClockRules: () => ({ rules: null }),
}));
vi.mock('../chat-live', async () => ({
  chatTopics: (city: string | null, house: string) =>
    city === null ? null : [`chat:${city}`, `house:${house}`],
  useChatLive: (await import('../chat-fake')).useFakeChatLive,
}));
const { fake, messageRow, resetFake } = await import('../chat-fake');
const { MessagesScreen } = await import('./Messages');

async function show(language: 'fr' | 'en' = 'fr') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: language,
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  render(
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
  resetFake();
});
afterEach(cleanup);
const channelButton = (name: RegExp) => screen.getByRole('button', { name });
const shown = () =>
  within(screen.getByRole('list', { name: fr.messages.list }))
    .getAllByRole('listitem')
    .map((item) => [
      item.querySelector('.font-semibold')?.textContent,
      item.querySelector('time')?.getAttribute('dateTime'),
      item.children[1]?.textContent,
    ]);

describe('onglet Messages (#274)', () => {
  it('le canal de la cité ouvert d’abord, ses messages nommés et datés, un message masqué dit tel', async () => {
    await show();
    expect(channelButton(/^Canal de Kallistè/).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('heading', { level: 2, name: 'Canal de Kallistè' })).toBeTruthy();
    expect(shown()).toEqual([
      ['Bacchiades', '2026-11-17T10:02:00.000Z', 'Texte m1'],
      ['Votre maison', '2026-11-17T10:03:00.000Z', 'Texte m2'],
      ['Bacchiades', '2026-11-17T10:04:00.000Z', fr.messages.hidden],
    ]);
  });

  it('les non lus de chaque canal et leur total, en texte ; ouvrir une conversation la montre et la lit', async () => {
    await show();
    const direct = channelButton(/^Conversation avec Philaïdes/);
    expect(direct.textContent).toBe('Conversation avec Philaïdes2 messages non lus');
    expect(screen.getByText('2 messages non lus', { selector: 'p' })).toBeTruthy();
    fireEvent.click(direct);
    expect(direct.getAttribute('aria-current')).toBe('true');
    expect(channelButton(/^Canal de Kallistè/).getAttribute('aria-current')).toBeNull();
    expect(shown().map(([, , body]) => body)).toEqual(['Texte d1', 'Texte d2']);
    expect(direct.textContent).toBe('Conversation avec Philaïdes');
    // Un message arrivé ailleurs, relu à la diffusion suivante.
    fake.messages.push(messageRow('m4', 'city', 'h3', 7));
    await act(async () => fake.signal());
    expect(channelButton(/^Canal de Kallistè/).textContent).toBe(
      'Canal de Kallistè1 message non lu',
    );
  });

  it('un message masqué en direct perd son texte à la diffusion du masquage (#532)', async () => {
    await show();
    expect(shown().map(([, , body]) => body)).toContain('Texte m2');
    // La base masque le message ; la diffusion ne porte que le canal, l'écran relit.
    const index = fake.messages.findIndex((row) => row['id'] === 'm2');
    fake.messages[index] = messageRow('m2', 'city', 'h1', 3, true);
    await act(async () => fake.signal('city'));
    expect(shown().map(([, , body]) => body)).not.toContain('Texte m2');
    expect(shown().filter(([, , body]) => body === fr.messages.hidden)).toHaveLength(2);
  });

  it('sans Realtime, l’écran dit qu’il relit à l’intervalle réglé ; en direct, il se tait (fr et en)', async () => {
    fake.live = 'polling';
    await show();
    expect(screen.getAllByRole('status')[0]?.textContent).toBe(
      "Les messages ne viennent plus en direct : l'écran les relit toutes les 42 secondes.",
    );
    cleanup();
    await show('en');
    expect(screen.getAllByRole('status')[0]?.textContent).toBe(
      'Messages no longer arrive live: the screen rereads them every 42 seconds.',
    );
    cleanup();
    fake.live = 'live';
    await show('en');
    expect(screen.getAllByRole('status')[0]?.textContent).toBe('');
    expect(channelButton(/^Kallistè channel/)).toBeTruthy();
  });

  it('un canal sans message le dit ; une lecture en échec se dit et se relit', async () => {
    fake.messages = [];
    await show();
    expect(screen.getByText(fr.messages.none)).toBeTruthy();
    cleanup();
    fake.channels = null;
    await show();
    expect(screen.getByRole('alert').textContent).toBe(fr.app.loadFailed);
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });

  it('sur téléphone : la liste d’abord, un canal n’est lu que montré ; le retour rend le foyer au canal', async () => {
    const wide = window.matchMedia;
    window.matchMedia = ((media: string) => ({
      matches: false,
      media,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      await show();
      const city = channelButton(/^Canal de Kallistè/);
      // La liste montrée, le canal de la cité n'est pas marqué lu.
      expect(city.textContent).toMatch(/non lus?$/);
      fireEvent.click(city);
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 2, name: 'Canal de Kallistè' }),
      );
      expect(city.textContent).toBe('Canal de Kallistè');
      fireEvent.click(screen.getByRole('button', { name: /^Canaux, 2 messages non lus$/ }));
      expect(document.activeElement).toBe(city);
    } finally {
      window.matchMedia = wide;
    }
  });
});
