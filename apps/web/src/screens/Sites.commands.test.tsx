// @vitest-environment jsdom
import { INITIAL_CONFIG } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Un champ de blé démarré il y a longtemps : il a de quoi être récolté, seul ou par « Tout récolter ».
const field = {
  id: 's1',
  city_id: 'c1',
  recipe_id: 'grow_wheat',
  cycle_started_at: '2026-01-01T00:00:00Z',
  halted_at: null,
};
const api = vi.hoisted(() => ({ collectSite: vi.fn() }));
vi.mock('../api', () => ({
  collectSite: api.collectSite,
  acquireSite: vi.fn(),
  restartSite: vi.fn(),
  setSiteRecipe: vi.fn(),
}));
vi.mock('../data', async () => {
  const { parseSiteRules } = await import('../site-rules');
  const rules = parseSiteRules(INITIAL_CONFIG);
  const rows = [field];
  const reload = () => Promise.resolve(rows);
  return {
    useRows: () => ({ rows, failed: false, reload }),
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

// jsdom ne fait pas défiler : le message qui annonce l'issue appelle `scrollIntoView`.
Element.prototype.scrollIntoView = () => undefined;

beforeEach(() => {
  api.collectSite.mockReset();
  window.sessionStorage.clear();
});
afterEach(cleanup);

const alerts = () =>
  screen
    .queryAllByRole('alert')
    .map((region) => region.textContent)
    .join(' ');
const statuses = () =>
  screen
    .queryAllByRole('status')
    .map((region) => region.textContent)
    .join(' ');
const collected = {
  ok: true,
  replayed: false,
  data: { outputs: [{ goodId: 'wheat', quantity: 1 }] },
};

describe('une commande qui lève ne bloque pas la carte des sites', () => {
  it.each([
    ['Récolter', fr.home.collectSite.replace('{{site}}', fr.recipes.grow_wheat)],
    ['Tout récolter', new RegExp(`^${fr.home.collectAll}`)],
  ])('« %s » : l’erreur est annoncée, puis la commande repart', async (_name, label) => {
    api.collectSite.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    api.collectSite.mockResolvedValueOnce(collected);
    await show();
    const button = await screen.findByRole('button', { name: label });

    fireEvent.click(button);
    await waitFor(() => expect(alerts()).toContain(fr.errors.INTERNAL));
    // Les contrôles sont de nouveau prêts : un nouveau clic envoie bien une nouvelle commande.
    expect(button.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(button);
    await waitFor(() => expect(api.collectSite).toHaveBeenCalledTimes(2));
    // Le second envoi aboutit : sa réussite est annoncée et l'erreur effacée.
    await waitFor(() => expect(statuses()).toMatch(/Récolte engrangée/));
    expect(alerts()).not.toContain(fr.errors.INTERNAL);
  });
});
