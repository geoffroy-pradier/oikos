// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

// Onglet Cité, chronique (#271) : la lecture de `chronicle_articles` est simulée.
const state = vi.hoisted(() => ({
  rows: [] as unknown[] | null,
  reads: [] as { view: string; filters: unknown; latest: unknown }[],
  reloads: 0,
}));
// `reload` relit comme le vrai : l'écran est rendu de nouveau avec les lignes du moment.
vi.mock('../data', async () => {
  const { useState } = await import('react');
  return {
    useRows: (
      view: string,
      _columns: string,
      _order: string,
      filters: unknown,
      latest: unknown,
    ) => {
      const [, rerender] = useState(0);
      state.reads.push({ view, filters, latest });
      return {
        rows: state.rows,
        failed: state.rows === null,
        reload: () => (state.reloads++, rerender((n) => n + 1), Promise.resolve(state.rows)),
      };
    },
  };
});
const { CityChronicle } = await import('./CityChronicle');

// 20 409 : le 17 novembre 2025 ; 20 408, la veille.
const article = (id: string, gameDay: number, extra: object = {}) => ({
  id,
  city_id: 'c1',
  game_day: gameDay,
  text_fr: `Journée ${id}.\n\nLa cité compte 12 habitants.`,
  text_en: `Day ${id}.\n\nThe city counts 12 inhabitants.`,
  source: 'fallback',
  ...extra,
});
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
        <CityChronicle />
      </HouseProvider>
    </I18nextProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.rows = [];
  state.reads = [];
  state.reloads = 0;
});

describe('onglet Cité : chronique de la cité (#271)', () => {
  it('lit les sept dernières chroniques de la cité ; aucune : la carte le dit', async () => {
    await show();
    expect(state.reads.at(-1)).toEqual({
      view: 'chronicle_articles',
      filters: { city_id: 'c1' },
      latest: { limit: 7 },
    });
    expect(screen.getByText(fr.chronicle.none)).toBeTruthy();
  });

  it('la dernière en entier, en paragraphes ; les précédentes repliées, à ouvrir au clavier', async () => {
    state.rows = [
      article('a', 20_408),
      article('b', 20_409, { source: 'ai' }),
      article('x', 20_409, { city_id: 'c2' }),
    ];
    await show();
    const [latest] = screen.getAllByRole('article');
    expect(latest?.querySelector('h3')?.textContent).toBe('Chronique du 17 novembre 2025');
    expect([...(latest?.querySelectorAll('p') ?? [])].map((p) => p.textContent)).toEqual([
      'Journée b.',
      'La cité compte 12 habitants.',
      fr.chronicle.aiNote,
    ]);
    // Une chronique d'une autre cité n'est pas montrée.
    expect(screen.queryByText('Journée x.')).toBeNull();
    const summary = screen.getByText('Chronique du 16 novembre 2025');
    expect(summary.tagName).toBe('SUMMARY');
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
    expect(details?.textContent).not.toContain(fr.chronicle.aiNote);
    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(details?.textContent).toContain('Journée a.');
  });

  it('en anglais : le texte anglais et ses dates', async () => {
    state.rows = [article('b', 20_409)];
    await show('en');
    expect(screen.getByRole('heading', { name: 'Chronicle of November 17, 2025' })).toBeTruthy();
    expect(screen.getByText('The city counts 12 inhabitants.')).toBeTruthy();
    expect(screen.queryByText(en.chronicle.aiNote)).toBeNull();
  });

  it('lecture en échec ou ligne illisible : annoncée ; « Réessayer » relit et le foyer va au titre', async () => {
    state.rows = [{ ...article('b', 20_409), source: 'oracle' }];
    await show();
    expect(screen.getByRole('alert').textContent).toBe(fr.app.loadFailed);
    cleanup();
    state.rows = null;
    await show();
    state.rows = [article('b', 20_409)];
    const retry = screen.getByRole('button', { name: fr.app.retry });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(state.reloads).toBe(1);
    expect(screen.getByText('Journée b.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: fr.chronicle.title }));
  });
});
