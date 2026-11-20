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

describe('état local périmé : l’API reste l’arbitre de la récolte d’un site (#864)', () => {
  it.each([
    ['NOTHING_TO_COLLECT', fr.errors.NOTHING_TO_COLLECT],
    ['MISSING_INPUTS', fr.errors.MISSING_INPUTS],
  ])(
    'refus %s : traduit sous le site, le foyer reste sur « Récolter », toujours actif',
    async (code, text) => {
      api.collectSite.mockResolvedValueOnce({ ok: false, error: { code, message: code } });
      await show();
      // L'écran croit le champ prêt : le bouton est actif et la commande part.
      const button = await screen.findByRole('button', {
        name: fr.home.collectSite.replace('{{site}}', fr.recipes.grow_wheat),
      });
      expect(button.getAttribute('aria-disabled')).toBe('false');
      button.focus();
      fireEvent.click(button);
      const row = screen.getByRole('heading', { name: fr.recipes.grow_wheat }).closest('li');
      await waitFor(() => expect(row?.querySelector('[role="alert"]')?.textContent).toBe(text));
      expect(api.collectSite).toHaveBeenCalledWith('s1', 't');
      expect(document.activeElement).toBe(button);
      expect(button.getAttribute('aria-disabled')).toBe('false');
    },
  );
});

describe('le résultat suit la fiche que les relectures agrandissent, sans retenir le joueur (#869)', () => {
  const observers: { callback: () => void; disconnected: boolean }[] = [];
  const scrolled: string[] = [];
  const live = () => observers.filter((observer) => !observer.disconnected);
  const harvested = () => scrolled.filter((text) => /Récolte engrangée/.test(text)).length;
  async function harvest() {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        entry = { callback: (): void => undefined, disconnected: false };
        constructor(callback: () => void) {
          this.entry.callback = callback;
          observers.push(this.entry);
        }
        observe() {}
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this.textContent ?? '');
    });
    api.collectSite.mockResolvedValueOnce(collected);
    await show();
    fireEvent.click(
      await screen.findByRole('button', {
        name: fr.home.collectSite.replace('{{site}}', fr.recipes.grow_wheat),
      }),
    );
    await waitFor(() => expect(statuses()).toMatch(/Récolte engrangée/));
    await waitFor(() => expect(live()).toHaveLength(1));
    expect(harvested()).toBe(1);
    return live()[0];
  }
  afterEach(() => {
    observers.length = 0;
    scrolled.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('une fiche qui grandit au-dessus du message le rend de nouveau dans la fenêtre', async () => {
    const observer = await harvest();
    observer?.callback();
    observer?.callback();
    expect(harvested()).toBe(3);
  });

  it('le premier geste du joueur arrête le suivi : son défilement n’est jamais interrompu', async () => {
    const observer = await harvest();
    fireEvent.wheel(window);
    expect(observer?.disconnected).toBe(true);
    // Déconnecté, l'observateur ne rappelle plus : une relecture qui arrive ensuite ne ramène plus la page.
    expect(live()).toHaveLength(0);
  });

  it('sans geste, le suivi s’arrête de lui-même, borné dans le temps', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const observer = await harvest();
    vi.advanceTimersByTime(5_000);
    expect(observer?.disconnected).toBe(true);
  });
});

describe('fiche de site (#869)', () => {
  it('la production en cours a sa barre de progression, nommée par le site', async () => {
    await show();
    const bar = await screen.findByRole('progressbar', {
      name: fr.production.nextOf.replace('{{site}}', fr.recipes.grow_wheat),
    });
    expect(bar.getAttribute('aria-valuetext')).toBeTruthy();
  });
});
