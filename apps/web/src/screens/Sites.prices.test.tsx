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
const withPrices = (fieldCost: number, fieldUpkeep: number, dailyWageOboles = {}) =>
  parseSiteRules({
    recipes: config.recipes,
    sites: {
      ...config.sites,
      staff: { dailyWageOboles },
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
const state = vi.hoisted(() => ({
  rules: null as unknown,
  labor: [] as unknown[] | null,
  workforce: [] as unknown[],
}));
const api = vi.hoisted(() => ({ acquireSite: vi.fn(), restartSite: vi.fn() }));
vi.mock('../api', () => ({
  collectSite: vi.fn(),
  acquireSite: api.acquireSite,
  restartSite: api.restartSite,
  setSiteRecipe: vi.fn(),
}));
/** Identité de la cité du site : Kallistè, dont le salaire du jour vient des règles des sites. */
const identity = {
  city_id: 'c1',
  slug: 'kalliste',
  terroir: null,
  has_port: true,
  patron_god_id: null,
  starting_recipe_id: 'grow_wheat',
};
vi.mock('../data', () => {
  const [sites, identities] = [[halted], [identity]];
  return {
    useRows: (view: string) => {
      const rows =
        view === 'city_identity'
          ? identities
          : view === 'labor_market'
            ? state.labor
            : view === 'my_workforce'
              ? state.workforce
              : sites;
      return { rows, failed: false, reload: () => Promise.resolve(rows) };
    },
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
  state.labor = [];
  state.workforce = [];
});
afterEach(cleanup);

/** Clé et prix de chaque envoi d'une commande simulée. */
const sends = (command: typeof api.acquireSite) =>
  command.mock.calls.map((call) => ({ price: call[1] as unknown, key: call[3] as unknown }));

describe('prix envoyés par la carte des sites', () => {
  it('relance avec des salaires : le prix envoyé est l’entretien plus les salaires du site dans sa cité', async () => {
    // Champ : 30 d'entretien, 4 travailleurs à 5 oboles à Kallistè ; ailleurs, aucun salaire.
    state.rules = withPrices(600, 30, { kalliste: 5, elaia: 9 });
    // Réponse reçue : la clé ne reste pas en attente pour l'essai suivant.
    api.restartSite.mockResolvedValue({
      ok: true,
      data: { siteId: 's1', upkeepOboles: 30, wagesOboles: 20, cycleStartedAt: halted.halted_at },
    });
    await show();
    fireEvent.click(
      await screen.findByRole('button', { name: /^Relancer : .*8 drachmes 2 oboles/ }),
    );
    await waitFor(() => expect(api.restartSite).toHaveBeenCalledTimes(1));
    expect(sends(api.restartSite).map((sent) => sent.price)).toEqual([50]);
    expect(await screen.findByText(/Site relancé.*8 drachmes 2 oboles/)).toBeTruthy();
  });

  it('relance au salaire et à l’hébergement du jour de la cité (#258) : deux nuits pour deux non logés', async () => {
    // Salaire du jour 7 (et non 5, le salaire de base des règles), hébergement 3 : 30 + 4 × 7 + 2 × 3.
    state.rules = withPrices(600, 30, { kalliste: 5 });
    state.labor = [{ city_id: 'c1', wage_oboles: 7, lodging_oboles: 3 }];
    state.workforce = [{ site_id: 's1', unhoused: 2 }];
    api.restartSite.mockResolvedValue({
      ok: true,
      data: { siteId: 's1', upkeepOboles: 30, wagesOboles: 28, cycleStartedAt: halted.halted_at },
    });
    await show();
    fireEvent.click(
      await screen.findByRole('button', { name: /^Relancer : .*10 drachmes 4 oboles/ }),
    );
    await waitFor(() => expect(api.restartSite).toHaveBeenCalledTimes(1));
    expect(sends(api.restartSite).map((sent) => sent.price)).toEqual([64]);
  });

  it('fiche du site (#259) : personnel logé ou non, salaire du jour et coût d’un jour', async () => {
    state.rules = withPrices(600, 30, { kalliste: 5 });
    state.labor = [{ city_id: 'c1', wage_oboles: 7, lodging_oboles: 3 }];
    state.workforce = [{ site_id: 's1', workers: 4, housed: 2, unhoused: 2 }];
    await show();
    expect(await screen.findByText('4 travailleurs : 2 logés, 2 sans logement')).toBeTruthy();
    expect(screen.getByText('Salaire du jour : 1 drachme 1 obole par travailleur')).toBeTruthy();
    // 30 + 4 × 7 + 2 × 3 = 64 oboles : le prix de la relance.
    expect(screen.getByText(/^Coût d'un jour : 10 drachmes 4 oboles/)).toBeTruthy();
  });

  it('hébergement payant mais travailleurs du site non lus : aucun prix annoncé, rien à envoyer', async () => {
    state.labor = [{ city_id: 'c1', wage_oboles: 7, lodging_oboles: 3 }];
    await show();
    await screen.findAllByText(/Plafond d'accumulation/);
    expect(screen.queryByRole('button', { name: /^Relancer/ })).toBeNull();
  });

  it('marché du travail pas encore lu ou illisible : aucun prix de relance annoncé', async () => {
    state.labor = null;
    await show();
    await screen.findAllByText(/Plafond d'accumulation/);
    expect(screen.queryByRole('button', { name: /^Relancer/ })).toBeNull();
  });

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
