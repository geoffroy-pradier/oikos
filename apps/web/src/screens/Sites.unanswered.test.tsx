// @vitest-environment jsdom
import { INITIAL_CONFIG } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Clé d'une acquisition et avertissement d'une acquisition abandonnée, d'un écran à l'autre (ticket 176).
const site = (id: string) => ({
  id,
  city_id: 'c1',
  recipe_id: 'grow_wheat',
  cycle_started_at: '2026-01-01T00:00:00Z',
  halted_at: null,
});
const state = vi.hoisted(() => ({ rows: [] as unknown[] }));
const api = vi.hoisted(() => ({ acquireSite: vi.fn(), collectSite: vi.fn() }));
vi.mock('../api', () => ({
  collectSite: api.collectSite,
  acquireSite: api.acquireSite,
  restartSite: vi.fn(),
  setSiteRecipe: vi.fn(),
}));
vi.mock('../data', async () => {
  const { parseSiteRules } = await import('../site-rules');
  const rules = parseSiteRules(INITIAL_CONFIG);
  const reload = () => Promise.resolve(state.rows);
  return {
    useRows: () => ({ rows: state.rows, failed: false, reload }),
    useSiteRules: () => ({ rules, failed: false, reload }),
  };
});
vi.mock('../server-clock', () => ({
  serverClock: { now: () => new Date('2026-06-01T00:00:00Z') },
  syncServerClock: () => Promise.resolve(),
}));
const { SitesCard } = await import('./Sites');

async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        <SitesCard stock={[]} onChanged={() => Promise.resolve()} />
      </HouseProvider>
    </I18nextProvider>,
  );
}
Element.prototype.scrollIntoView = () => undefined;

const acquired = { ok: true, replayed: false, data: { recipeId: 'grow_wheat', costOboles: 600 } };
const keysSent = () => api.acquireSite.mock.calls.map((call) => call[3] as unknown);
const stored = () =>
  Object.keys(window.sessionStorage).filter((name) => name.startsWith('oikos.pending.h1.'));
const warned = () => screen.queryByText(fr.home.acquireUnanswered);
const submit = () => fireEvent.click(screen.getByRole('button', { name: fr.home.acquireSubmit }));
/** Écran quitté puis rouvert (onglet Agora, puis Maison). */
async function reopen() {
  cleanup();
  await show();
  await screen.findByRole('button', { name: fr.home.acquireSubmit });
}

beforeEach(() => {
  api.acquireSite.mockReset();
  api.collectSite.mockReset();
  window.sessionStorage.clear();
  state.rows = [site('s1')];
});
afterEach(cleanup);

describe('acquisition sans réponse, d’un écran à l’autre', () => {
  it('succès reçu par un écran quitté : l’écran rouvert, encore à 1 site, renvoie la même clé', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.acquireSite.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    api.acquireSite.mockResolvedValue({ ...acquired, replayed: true });
    await show();
    submit();
    await waitFor(() => expect(api.acquireSite).toHaveBeenCalledTimes(1));
    // Onglet quitté pendant l'envoi, puis rouvert : le nouvel écran lit 1 site, avant que l'ancien ne
    // reçoive le succès.
    await reopen();
    answer(acquired);
    await waitFor(() =>
      expect(window.sessionStorage.getItem(stored()[0] ?? '')).toMatch(/answered/),
    );
    submit();
    await waitFor(() => expect(api.acquireSite).toHaveBeenCalledTimes(2));
    expect(keysSent()[1]).toBe(keysSent()[0]);
    await screen.findByText(/^Ce site était déjà acquis/);
    // La relecture montre le site acquis : la clé est rendue, sans avertissement.
    state.rows = [site('s1'), site('s2')];
    await reopen();
    expect(stored()).toEqual([]);
    expect(warned()).toBeNull();
  });

  it('clic pendant une récolte : rien ne part, aucune clé n’est rangée', async () => {
    let harvested: (value: unknown) => void = () => undefined;
    api.collectSite.mockReturnValueOnce(new Promise((resolve) => (harvested = resolve)));
    await show();
    fireEvent.click(await screen.findByRole('button', { name: /^Récolter : / }));
    submit();
    expect(api.acquireSite).not.toHaveBeenCalled();
    expect(stored()).toEqual([]);
    harvested({ ok: true, replayed: false, data: { outputs: [] } });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: fr.home.acquireSubmit }).getAttribute('aria-disabled'),
      ).toBe('false'),
    );
  });

  it('avertissement rappelé à chaque ouverture, jusqu’à ce que le joueur dise avoir vérifié', async () => {
    // Acquisition restée sans réponse à 1 site ; la lecture suivante en montre 2.
    window.sessionStorage.setItem(
      'oikos.pending.h1.acquire:grow_wheat:1',
      JSON.stringify({ key: 'k', input: 600 }),
    );
    state.rows = [site('s1'), site('s2')];
    await show();
    expect(await screen.findByText(fr.home.acquireUnanswered)).toBeTruthy();
    expect(stored()).toEqual([]);
    await reopen();
    expect(warned()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: fr.home.acquireChecked }));
    expect(warned()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: fr.home.sites }));
    await reopen();
    expect(warned()).toBeNull();
    expect(screen.queryByRole('button', { name: fr.home.acquireChecked })).toBeNull();
  });

  it('une nouvelle acquisition lève l’avertissement', async () => {
    window.sessionStorage.setItem('oikos.unanswered.h1', '1');
    api.acquireSite.mockResolvedValue({ ok: false, error: { code: 'INSUFFICIENT_FUNDS' } });
    await show();
    expect(await screen.findByText(fr.home.acquireUnanswered)).toBeTruthy();
    submit();
    await waitFor(() => expect(api.acquireSite).toHaveBeenCalledTimes(1));
    await reopen();
    expect(warned()).toBeNull();
  });
});
