// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import { parseSiteRules } from '../site-rules';

// Prix envoyés par la carte des sites : celui affiché au premier envoi, puis, tant que la clé reste en
// attente, ce même prix, même quand le tarif relu a changé (ticket 145).
const config = INITIAL_CONFIG as GameConfig;
const withPrices = (fieldCost: number, fieldUpkeep: number) =>
  parseSiteRules({
    recipes: config.recipes,
    sites: {
      ...config.sites,
      acquisitionCostOboles: { ...config.sites.acquisitionCostOboles, field: fieldCost },
      upkeep: {
        ...config.sites.upkeep,
        coefficientBps: 10_000,
        dailyOboles: { ...config.sites.upkeep.dailyOboles, field: fieldUpkeep },
      },
    },
  });
const halted = {
  id: 's1',
  city_id: 'c1',
  recipe_id: 'grow_wheat',
  cycle_started_at: '2026-05-31T20:00:00Z',
  halted_at: '2026-05-31T22:00:00Z',
};
const state = vi.hoisted(() => ({ rules: null as unknown }));
const api = vi.hoisted(() => ({ acquireSite: vi.fn(), restartSite: vi.fn() }));
vi.mock('../api', () => ({
  collectSite: vi.fn(),
  acquireSite: api.acquireSite,
  restartSite: api.restartSite,
  setSiteRecipe: vi.fn(),
}));
vi.mock('../data', () => {
  const rows = [halted];
  return {
    useRows: () => ({ rows, failed: false, reload: () => Promise.resolve(rows) }),
    useSiteRules: () => ({ rules: state.rules, failed: false, reload: () => Promise.resolve() }),
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
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        <SitesCard stock={[]} onChanged={() => Promise.resolve()} />
      </HouseProvider>
    </I18nextProvider>,
  );
}
Element.prototype.scrollIntoView = () => undefined;

const LOST = { ok: false, error: { code: 'INTERNAL', message: 'lost' } };
const CHANGED = { ok: false, error: { code: 'PRICE_CHANGED', message: 'changed' } };
beforeEach(() => {
  api.acquireSite.mockReset();
  api.restartSite.mockReset();
  window.sessionStorage.clear();
  state.rules = withPrices(600, 30);
});
afterEach(cleanup);

/** Clé et prix de chaque envoi d'une commande simulée. */
const sends = (command: typeof api.acquireSite) =>
  command.mock.calls.map((call) => ({ price: call[1] as unknown, key: call[3] as unknown }));

describe('prix envoyés par la carte des sites', () => {
  it('relance : le prix affiché, puis le même sous la clé en attente ; après « prix changé », le nouveau sous une clé neuve', async () => {
    api.restartSite.mockResolvedValueOnce(LOST).mockResolvedValueOnce(CHANGED);
    api.restartSite.mockResolvedValue(LOST);
    await show();
    const restart = () => screen.getByRole('button', { name: /^Relancer : / });
    fireEvent.click(await screen.findByRole('button', { name: /^Relancer : .*5 drachmes/ }));
    await waitFor(() => expect(api.restartSite).toHaveBeenCalledTimes(1));
    // Le tarif relu passe à 36 oboles (écran rouvert) : le bouton l'affiche, mais la clé en attente
    // repart à 30.
    state.rules = withPrices(600, 36);
    cleanup();
    await show();
    await screen.findByRole('button', { name: /^Relancer : .*6 drachmes/ });
    fireEvent.click(restart());
    await waitFor(() => expect(api.restartSite).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText(fr.errors.PRICE_CHANGED)).not.toHaveLength(0));
    fireEvent.click(restart());
    await waitFor(() => expect(api.restartSite).toHaveBeenCalledTimes(3));
    const [first, second, third] = sends(api.restartSite);
    expect([first?.price, second?.price, third?.price]).toEqual([30, 30, 36]);
    expect(second?.key).toBe(first?.key);
    expect(third?.key).not.toBe(first?.key);
  });

  it('acquisition : de même, au prix d’acquisition affiché', async () => {
    api.acquireSite.mockResolvedValueOnce(LOST).mockResolvedValueOnce(CHANGED);
    api.acquireSite.mockResolvedValue(LOST);
    await show();
    const submit = await screen.findByRole('button', { name: fr.home.acquireSubmit });
    fireEvent.change(screen.getByLabelText(fr.home.acquireRecipe), {
      target: { value: 'grow_wheat' },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(api.acquireSite).toHaveBeenCalledTimes(1));
    state.rules = withPrices(660, 30);
    cleanup();
    await show();
    fireEvent.change(screen.getByLabelText(fr.home.acquireRecipe), {
      target: { value: 'grow_wheat' },
    });
    expect(screen.getByRole('option', { name: /^Champ de blé.*110 drachmes/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: fr.home.acquireSubmit }));
    await waitFor(() => expect(api.acquireSite).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText(fr.errors.PRICE_CHANGED)).not.toHaveLength(0));
    fireEvent.click(screen.getByRole('button', { name: fr.home.acquireSubmit }));
    await waitFor(() => expect(api.acquireSite).toHaveBeenCalledTimes(3));
    const [first, second, third] = sends(api.acquireSite);
    expect(api.acquireSite.mock.calls.map((call) => call[0] as unknown)).toEqual([
      'grow_wheat',
      'grow_wheat',
      'grow_wheat',
    ]);
    expect([first?.price, second?.price, third?.price]).toEqual([600, 600, 660]);
    expect(second?.key).toBe(first?.key);
    expect(third?.key).not.toBe(first?.key);
  });
});
