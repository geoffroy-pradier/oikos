// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Liturgies de la saison, dans l'onglet Cité (#723) : lectures simulées vue par vue.
const state = vi.hoisted(() => ({
  views: {} as Record<string, unknown[] | null>,
  columns: {} as Record<string, string>,
}));
vi.mock('../data', () => ({
  useRows: (view: string, columns: string, _order: string, filters: unknown = {}) => {
    state.columns[view] = columns;
    if (view === 'houses' && filters === null)
      return { rows: null, failed: false, reload: () => Promise.resolve(null) };
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
const { CityLiturgies } = await import('./CityLiturgies');

const row = (
  house_id: string,
  genre: string,
  status = 'assigned',
  season = 5,
  due_at = '2999-01-01T04:00:00+00:00',
) => ({
  house_id,
  season,
  genre,
  status,
  due_at,
});
const houses = [
  { id: 'h1', name: 'Maison Test', citizenship_status: 'citizen' },
  { id: 'h2', name: 'Maison Alpha', citizenship_status: 'citizen' },
  { id: 'h3', name: 'Maison Zêta', citizenship_status: 'metic' },
];

async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'citizen' }}
      >
        <CityLiturgies />
      </HouseProvider>
    </I18nextProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.views = {};
});

describe('liturgies de la saison dans la cité (#723)', () => {
  it('maison, genre et état de chaque liturgie de la saison la plus récente, rangées par nom', async () => {
    state.views = {
      houses,
      city_liturgies: [
        row('h3', 'festival', 'levied'),
        row('h1', 'choregia'),
        row('h2', 'trierarchy', 'performed'),
        row('hancien', 'festival', 'assigned', 4),
      ],
    };
    await show();
    const lists = within(screen.getByRole('list'));
    const cards = lists.getAllByRole('listitem').map((item) => item.textContent);
    expect(cards).toEqual([
      expect.stringMatching(/^Maison AlphaGenreTriérarchieÉtatAccomplie$/),
      expect.stringMatching(/^Maison TestGenreChorégieÉtatÀ accomplir$/),
      expect.stringMatching(/^Maison ZêtaGenreFêteÉtatPrélevée d'office$/),
    ]);
  });

  it('aucun montant : ni dû ni colonne de montant n’est demandé, ni rien qui ressemble à une somme', async () => {
    state.views = { houses, city_liturgies: [row('h1', 'festival'), row('h2', 'festival')] };
    const { container } = await show();
    expect(state.columns['city_liturgies']).toBe('house_id, season, genre, status, due_at');
    expect(container.textContent).not.toMatch(/drachme|obole/);
  });

  it('compte les liturgies par état ; une échue non réglée compte parmi celles à accomplir', async () => {
    state.views = {
      houses,
      city_liturgies: [
        row('h1', 'festival', 'assigned', 5, '2020-01-01T04:00:00+00:00'),
        row('h2', 'festival', 'performed'),
        row('h3', 'festival', 'assigned'),
      ],
    };
    await show();
    // Cartes du haut : la première liste de définitions, les cartes du tableau étant des listes à part.
    const cards = screen.getAllByRole('term').slice(0, 4);
    const counts = Object.fromEntries(
      cards.map((label) => [label.textContent, label.nextElementSibling?.textContent]),
    );
    expect(counts).toEqual({
      'Maisons désignées': '3',
      'À accomplir, échues comprises': '2',
      Accomplies: '1',
      "Prélevées d'office": '0',
    });
  });

  it('la maison désignée a le lien vers sa liturgie, une autre non', async () => {
    state.views = { houses, city_liturgies: [row('h1', 'festival')] };
    await show();
    expect(screen.getByRole('link', { name: 'Voir ma liturgie' }).getAttribute('href')).toBe(
      '/cite/liturgie',
    );
    cleanup();
    state.views = { houses, city_liturgies: [row('h2', 'festival')] };
    await show();
    expect(screen.queryByRole('link', { name: 'Voir ma liturgie' })).toBeNull();
  });

  it('aucune liturgie : un état vide ; une lecture en échec : une erreur, jamais le vide', async () => {
    state.views = { houses, city_liturgies: [] };
    await show();
    expect(screen.getByText(/^Aucune liturgie n'a encore été désignée/)).toBeTruthy();
    cleanup();
    state.views = { houses, city_liturgies: null };
    await show();
    expect(screen.queryByText(/^Aucune liturgie n'a encore été désignée/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });
  it('affiche le numéro de la saison désignée, pour qu’une ancienne liste ne paraisse pas courante', async () => {
    state.views = { houses, city_liturgies: [row('h1', 'festival', 'assigned', 7)] };
    await show();
    expect(screen.getByText(/^Saison n°.7\./)).toBeTruthy();
  });

  it('le compteur À accomplir dit qu’il compte aussi les liturgies échues', async () => {
    state.views = { houses, city_liturgies: [row('h1', 'festival')] };
    await show();
    expect(screen.getByText('À accomplir, échues comprises')).toBeTruthy();
  });
});
