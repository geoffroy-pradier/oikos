// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Écran de la liturgie de la maison (#723) : lectures simulées vue par vue, commande espionnée.
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
const api = vi.hoisted(() => ({ performLiturgy: vi.fn() }));
vi.mock('../api', () => ({ performLiturgy: api.performLiturgy }));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
  useClockRules: () => ({ rules: null }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
const { LiturgyScreen } = await import('./Liturgy');

const liturgy = (extra = {}) => ({
  id: 'l1',
  city_id: 'c1',
  season: 3,
  genre: 'choregia',
  due: 7500,
  due_at: '2999-01-01T04:00:00+00:00',
  status: 'assigned',
  ...extra,
});
const rules = { honorGain: 40, charisGain: 25, evasionHonorLoss: 90, maxSplendorBps: 10_000 };
const identity = {
  city_id: 'c1',
  terroir: ['wheat'],
  has_port: true,
  patron_god_id: 'athena',
  starting_recipe_id: 'wheat',
};
const plain = (node: HTMLElement | null) => node?.textContent?.replace(/[\u00a0\u202f]/g, ' ');

async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = {
    id: 'h1',
    name: 'Test',
    cityId: 'c1',
    accessToken: 'jeton',
    cityName: 'Kallistè',
  };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'citizen' }}
      >
        <LiturgyScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));

beforeEach(() => {
  api.performLiturgy.mockReset();
  api.performLiturgy.mockResolvedValue({
    ok: true,
    replayed: false,
    data: { due: 7500, splendor: 1000, honorGained: 45, charisGained: 28 },
  });
  state.views = {
    my_liturgies: [liturgy()],
    liturgy_rules: [{ rules }],
    city_identity: [identity],
    my_honor_entries: [],
  };
});
afterEach(() => {
  cleanup();
  state.views = {};
});

describe('liturgie de la maison (#723)', () => {
  it('annonce le genre, le dû en drachmes et oboles et l’échéance, avec le bouton d’accomplissement', async () => {
    await show();
    expect(screen.getByRole('heading', { level: 2, name: 'Chorégie' })).toBeTruthy();
    expect(plain(screen.getByText('Dû').closest('div'))).toContain('1 250 drachmes');
    expect(screen.getByText('À accomplir')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accomplir ma liturgie' })).toBeTruthy();
  });

  it('le bouton ouvre la feuille ; accomplie, elle se ferme et l’accomplissement est annoncé, l’écran relu', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Accomplir ma liturgie' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Accomplir ma liturgie' }));
    next();
    next();
    fireEvent.click(sheet.getByRole('button', { name: /^Payer / }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(plain(screen.getByRole('status'))).toContain('Liturgie accomplie : ');
    expect(api.performLiturgy.mock.calls[0]?.slice(0, 2)).toEqual([
      { liturgyId: 'l1', expectedDue: 7500, splendor: 0 },
      'jeton',
    ]);
  });

  it('prélevée d’office : le dit, avec la Timè perdue du journal, sans bouton', async () => {
    state.views.my_liturgies = [liturgy({ status: 'levied' })];
    state.views.my_honor_entries = [
      { amount: -90, reason: 'liturgy_evaded', reference: 'l1' },
      { amount: 30, reason: 'liturgy_performed', reference: 'autre' },
    ];
    await show();
    expect(screen.getByText("Prélevée d'office")).toBeTruthy();
    expect(
      plain(screen.getByText(/^Prélevée d'office : la liturgie n'a pas été accomplie/)),
    ).toContain('Timè perdue : 90.');
    expect(screen.queryByRole('button', { name: 'Accomplir ma liturgie' })).toBeNull();
  });

  it('échue sans être réglée : prélèvement annoncé avec la perte de la configuration, plus d’accomplissement', async () => {
    state.views.my_liturgies = [liturgy({ due_at: '2020-01-01T04:00:00+00:00' })];
    await show();
    expect(screen.getByText('Échue')).toBeTruthy();
    expect(plain(screen.getByText(/sera prélevée d'office à la prochaine clôture/))).toContain(
      'perte de Timè de 90',
    );
    expect(screen.queryByRole('button', { name: 'Accomplir ma liturgie' })).toBeNull();
  });

  it('une lecture en échec n’est pas prise pour une absence de liturgie', async () => {
    state.views.my_liturgies = null;
    await show();
    expect(screen.queryByText(/^Aucune liturgie n'est confiée/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('accomplie : la Timè gagnée vient du journal ; aucune liturgie : un état vide', async () => {
    state.views.my_liturgies = [liturgy({ status: 'performed' })];
    state.views.my_honor_entries = [{ amount: 45, reason: 'liturgy_performed', reference: 'l1' }];
    await show();
    expect(plain(screen.getByText(/^Vous avez accompli cette liturgie\./))).toBe(
      'Vous avez accompli cette liturgie. Timè gagnée : 45.',
    );
    cleanup();
    state.views.my_liturgies = [];
    await show();
    expect(screen.getByText(/^Aucune liturgie n'est confiée à votre maison/)).toBeTruthy();
  });
});
