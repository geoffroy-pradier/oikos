// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import { parseShipRules, type ShipRules } from '../ship-rules';

const sent = vi.hoisted(() => ({
  calls: [] as { input: unknown; key: string }[],
  answers: [] as unknown[],
}));
vi.mock('../data', () => ({
  // Aucune grâce en attente : les durées sont celles du calme.
  useRows: (view: string) => ({
    rows:
      view === 'my_graces' ? [] : [{ city_id: 'k', good_id: 'wheat', quantity: 100, reserved: 20 }],
    failed: false,
    reload: () => Promise.resolve(null),
  }),
}));
vi.mock('../api', () => ({
  departVoyage: (input: unknown, _token: string, key: string) => {
    sent.calls.push({ input, key });
    return Promise.resolve(sent.answers.shift());
  },
}));
const { Departure } = await import('./Departure');

const SLUGS = new Map(Object.entries({ k: 'kalliste', e: 'elaia', a: 'ampelos', h: 'halos' }));
const base = parseShipRules({ ships: (INITIAL_CONFIG as GameConfig).ships }) as ShipRules;
// Un droit de port payant à Elaia : 10 oboles ×1,25, arrondi à 13 ; provisions de 5 sur chaque route.
const RULES: ShipRules = {
  ...base,
  routes: base.routes.map((route) => ({ ...route, provisionsOboles: { coaster: 5 } })),
  portDues: {
    ...base.portDues,
    byClassOboles: { coaster: 10 },
    cityCoefficientBps: { elaia: 12_500 },
  },
};
const SHIP = { id: '', class_id: 'coaster', docked_city_id: 'k', laid_up_at: null };
const done = vi.fn((_notice: unknown) => Promise.resolve());

// Une clé d'intention survit au test (mémoire du module) : un navire neuf par test.
let shipNumber = 0;
async function mount(rules: ShipRules = RULES) {
  shipNumber += 1;
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'k', accessToken: 't', cityName: 'Kallistè' };
  const names = { k: 'Kallistè', e: 'Elaia', a: 'Ampélos', h: 'Halos' };
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: names, citizenshipStatus: 'metic' }}>
        <Departure
          ship={{ ...SHIP, id: `s${shipNumber}` }}
          shipName="Caboteur"
          rules={rules}
          slugs={SLUGS}
          voyageCounts={new Map()}
          onDone={done}
        />
      </HouseProvider>
    </I18nextProvider>,
  );
}
/** Étapes suivantes du départ (destination, cargaison, récapitulatif) : « Continuer ». */
const next = () => fireEvent.click(screen.getByRole('button', { name: fr.departure.next }));
const ok = {
  ok: true,
  replayed: false,
  data: { toCityId: 'e', arrivesAt: '2026-11-16T16:00:00Z', costOboles: 18 },
};
beforeEach(() => {
  sent.calls = [];
  sent.answers = [];
  done.mockClear();
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('départ d’un navire', () => {
  it('deux touches : la destination (durée et coût dits), puis « Partir » au coût annoncé', async () => {
    sent.answers.push(ok);
    await mount();
    expect(screen.getByLabelText(/Halos — 6 h de mer, coût 2 drachmes 3 oboles/)).toBeTruthy();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Elaia/));
    expect(screen.getByText(/Coût du départ : 3 drachmes \(provisions 5 oboles/)).toBeTruthy();
    next();
    next();
    expect(screen.getByText('Vers Elaia, 4 h de mer, sur lest.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Partir vers Elaia — 3 drachmes' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(sent.calls[0]?.input).toEqual({
      shipId: `s${shipNumber}`,
      fromCityId: 'k',
      toCityId: 'e',
      cargo: [],
      expectedCostOboles: 18,
    });
    expect(done.mock.calls[0]?.[0]).toMatchObject({ kind: 'status' });
    // Risque nul (configuration initiale) : le message de réussite n'en dit rien.
    expect((done.mock.calls[0]?.[0] as { text: string }).text).not.toMatch(/Risque/);
  });

  it('pertes en mer (#730) : le message de réussite dit le risque réellement fixé, celui de la réponse', async () => {
    sent.answers.push({ ...ok, data: { ...ok.data, lossRiskBps: 1_500 } });
    await mount();
    fireEvent.click(screen.getByLabelText(/Elaia/));
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: /Partir vers Elaia/ }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect((done.mock.calls[0]?.[0] as { text: string }).text).toMatch(
      /Risque de perte de la cargaison fixé au départ : 15\s?%\.$/,
    );
  });

  it('pertes en mer (#730) : le récapitulatif annonce le risque de la route ; nul, il ne dit rien', async () => {
    const risky = (route: ShipRules['routes'][number]) =>
      route.cities.includes('elaia') && route.cities.includes('kalliste')
        ? { ...route, lossRiskBps: 250, stormLossRiskBps: 1_000 }
        : route;
    await mount({ ...RULES, routes: RULES.routes.map(risky) });
    fireEvent.click(screen.getByLabelText(/Elaia/));
    expect(screen.getByText(/^Risque de perdre la cargaison en mer\s: 2,5\s?%\./)).toBeTruthy();
    // Sans tempête lue ici, la majoration ne joue pas ; vers Halos, route sans risque, rien n'est dit.
    fireEvent.click(screen.getByLabelText(/Halos/));
    expect(screen.queryByText(/Risque de perdre la cargaison/)).toBeNull();
  });

  it('cargaison prise dans le stock libre ; au-delà, rien ne part et l’écran dit pourquoi', async () => {
    sent.answers.push(ok);
    await mount();
    fireEvent.click(screen.getByLabelText(/Elaia/));
    next();
    const wheat = screen.getByLabelText(/Blé/);
    // Au-delà du stock libre, l'étape ne se valide pas : « Partir » n'est pas atteignable.
    const submit = () => screen.getByRole('button', { name: fr.departure.next });
    fireEvent.change(wheat, { target: { value: '81' } });
    expect(screen.getByRole('alert').textContent).toBe(fr.departure.overStock);
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(wheat, { target: { value: '80' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(submit());
    expect(screen.getByText('Vers Elaia, 4 h de mer ; cargaison : 80 × Blé.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Partir vers Elaia/ }));
    await waitFor(() => expect(sent.calls).toHaveLength(1));
    expect(sent.calls[0]?.input).toMatchObject({ cargo: [{ goodId: 'wheat', quantity: 80 }] });
  });

  it('réponse perdue puis une autre destination : clé neuve et entrée nouvelle, jamais l’ancienne', async () => {
    sent.answers.push({ ok: false, error: { code: 'INTERNAL', message: '' } }, ok);
    await mount();
    fireEvent.click(screen.getByLabelText(/Halos/));
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: /Partir vers Halos/ }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText(/Elaia/));
    fireEvent.click(screen.getByRole('button', { name: 'Partir vers Elaia — 3 drachmes' }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(2));
    expect(sent.calls[1]?.key).not.toBe(sent.calls[0]?.key);
    expect(sent.calls[1]?.input).toMatchObject({ toCityId: 'e', expectedCostOboles: 18 });
  });

  it('sans réponse, la même clé repart ; « le prix a changé » rend la main à une demande neuve', async () => {
    sent.answers.push(
      { ok: false, error: { code: 'INTERNAL', message: '' } },
      { ok: false, error: { code: 'PRICE_CHANGED', message: '' } },
      ok,
    );
    await mount();
    fireEvent.click(screen.getByLabelText(/Elaia/));
    next();
    next();
    const submit = () => fireEvent.click(screen.getByRole('button', { name: /Partir vers Elaia/ }));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      submit();
      await waitFor(() => expect(done).toHaveBeenCalledTimes(attempt));
      if (attempt === 2)
        expect(screen.getByRole('alert').textContent).toBe(fr.errors.PRICE_CHANGED);
    }
    const [first, second, third] = sent.calls.map((call) => call.key);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
    expect(done.mock.calls[1]?.[0]).toEqual({ kind: 'alert', text: fr.errors.PRICE_CHANGED });
    // Un refus reste dit dans la feuille, près de « Partir » ; il s'efface au nouvel envoi.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
