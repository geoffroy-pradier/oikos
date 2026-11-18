// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { parseReportReasons, reportedMessages } from '../reports';

// Signaler un message (#275) : lectures, abonnements et commande simulés.
const api = vi.hoisted(() => ({
  reports: [] as { messageId: string; reason: string; key: string; answer: (r: unknown) => void }[],
}));
vi.mock('../api', () => ({
  postMessage: () => new Promise(() => undefined),
  reportMessage: (messageId: string, reason: string, _token: string, key: string) =>
    new Promise((answer) => api.reports.push({ messageId, reason, key, answer })),
}));
vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('../data', async () => ({ useRows: (await import('../chat-fake')).useFakeRows }));
vi.mock('../chat-live', async () => ({
  chatTopics: (city: string | null, house: string) =>
    city === null ? null : [`chat:${city}`, `house:${house}`],
  useChatLive: (await import('../chat-fake')).useFakeChatLive,
}));
const { fake, resetFake } = await import('../chat-fake');
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
  api.reports.length = 0;
});
afterEach(cleanup);
const items = () =>
  within(screen.getByRole('list', { name: fr.messages.list })).getAllByRole('listitem');

describe('lectures du signalement', () => {
  it('motifs de la version en vigueur, du schéma partagé pour une version antérieure, aucun sans version', () => {
    expect(parseReportReasons([{ report_reasons: ['spam'] }])).toEqual(['spam']);
    expect(parseReportReasons([{ report_reasons: null }])).toHaveLength(5);
    expect(parseReportReasons([])).toEqual([]);
    expect(parseReportReasons([{ report_reasons: 'spam' }])).toBeNull();
    expect(reportedMessages([{ message_id: 'm1' }, { message_id: null }])).toEqual(new Set(['m1']));
  });
});

describe('signaler un message (#275)', () => {
  it('« Signaler » sous chaque message visible d’une autre maison, ni sous les siens ni sous un message masqué', async () => {
    fake.reports = [{ message_id: 'm9' }];
    await show();
    const [other, mine, hidden] = items();
    expect(
      within(other as HTMLElement).getByRole('button', {
        name: 'Signaler le message de Bacchiades',
      }),
    ).toBeTruthy();
    expect(within(mine as HTMLElement).queryByRole('button', { name: /^Signaler/ })).toBeNull();
    expect(within(hidden as HTMLElement).queryByRole('button', { name: /^Signaler/ })).toBeNull();
  });

  it('un message déjà signalé est dit tel ; sans motif en vigueur, rien ne se signale', async () => {
    fake.reports = [{ message_id: 'm1' }];
    await show();
    expect(
      within(items()[0] as HTMLElement).getByText('Vous avez signalé ce message.'),
    ).toBeTruthy();
    cleanup();
    resetFake();
    fake.rules = [];
    await show();
    expect(screen.queryByRole('button', { name: /^Signaler le message/ })).toBeNull();
  });

  it('au clavier : un motif, l’envoi sous une clé gardée sans réponse, puis le foyer sur le résultat', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Signaler le message de Bacchiades' }));
    const reason = screen.getByRole('combobox', {
      name: 'Motif du signalement du message de Bacchiades',
    });
    expect(document.activeElement).toBe(reason);
    expect(
      within(reason)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Publicité ou messages répétés', 'Autre manquement à la charte']);
    fireEvent.change(reason, { target: { value: 'other' } });
    fireEvent.submit(reason);
    const first = api.reports[0];
    expect([first?.messageId, first?.reason]).toEqual(['m1', 'other']);
    await act(async () => first?.answer({ ok: false, error: { code: 'INTERNAL', message: 'x' } }));
    expect(within(items()[0] as HTMLElement).getByRole('alert').textContent).toBe(
      fr.errors.INTERNAL,
    );
    fireEvent.submit(reason);
    expect(api.reports[1]?.key).toBe(first?.key);
    fake.reports = [{ message_id: 'm1' }];
    await act(async () =>
      api.reports[1]?.answer({ ok: true, data: { reportId: 'r1' }, replayed: false }),
    );
    const done = within(items()[0] as HTMLElement);
    const status = done.getByRole('status');
    expect(status.textContent).toBe("Message signalé : la modération l'examinera.");
    expect(document.activeElement).toBe(status);
    expect(done.getByText('Vous avez signalé ce message.')).toBeTruthy();
    expect(fake.reloads).toContain('my_reports:');
  });

  it('déjà signalé ailleurs : le but est atteint ; annuler rend le foyer au bouton', async () => {
    await show();
    const opener = () => screen.getByRole('button', { name: 'Signaler le message de Bacchiades' });
    fireEvent.click(opener());
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await act(async () => new Promise((resolve) => setTimeout(resolve)));
    expect(document.activeElement).toBe(opener());
    fireEvent.click(opener());
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le signalement' }));
    await act(async () =>
      api.reports[0]?.answer({ ok: false, error: { code: 'ALREADY_REPORTED', message: 'x' } }),
    );
    expect(screen.getByText("Message signalé : la modération l'examinera.")).toBeTruthy();
  });
});
