// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

const config = INITIAL_CONFIG as GameConfig;
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
const api = vi.hoisted(() => ({ propertyCommand: vi.fn() }));
vi.mock('../api', () => ({ propertyCommand: api.propertyCommand }));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
  useClockRules: () => ({ rules: null, failed: false, reload: () => Promise.resolve() }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useRouterState: () => '/immobilier',
}));
const { PropertyScreen } = await import('./Property');

const townhouse = config.properties.sizes.find((size) => size.id === 'townhouse');
const mine = {
  id: 'p9',
  city_id: 'c1',
  size_id: 'townhouse',
  lot: 9,
  condition: 6000,
  upkeep_unpaid_since: null,
};
async function showProperty(lng: 'fr' | 'en' = 'fr') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
      >
        <PropertyScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const lease = {
  id: 'l1',
  property_id: 'p5',
  city_id: 'c1',
  size_id: 'townhouse',
  lot: 5,
  tenant_house_id: 'h1',
  rent_oboles: 40,
  end_requested_at: null,
  ended_at: null,
  ended_day: null,
  end_reason: null,
};
beforeEach(() => {
  window.sessionStorage.clear();
  api.propertyCommand.mockReset();
  api.propertyCommand.mockResolvedValue({ ok: true, data: {}, replayed: false });
  state.views = {
    property_rules: [{ properties: config.properties }],
    city_properties: [
      { id: 'p1', city_id: 'c1', size_id: 'townhouse', lot: 1, for_sale: true, condition: 10000 },
    ],
    property_offers_upkeep: [
      {
        ...mine,
        property_id: 'p2',
        lot: 2,
        condition: 8000,
        kind: 'lease',
        price_oboles: 30,
        upkeep_unpaid: false,
        upkeep_unpaid_day: null,
      },
    ],
    my_properties: [mine],
    my_leases: [lease],
  };
});
afterEach(cleanup);
const sent = () => api.propertyCommand.mock.calls.map((call) => [call[0], call[1], call[3]]);
// Une commande s'ouvre dans une feuille, au prix vu, puis se confirme. Le tableau (ordinateur) et les
// fiches (téléphone) portent le même bouton : le premier suffit.
const open = (name: RegExp) =>
  fireEvent.click(screen.getAllByRole('button', { name })[0] as HTMLElement);
const confirm = () =>
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: /^(Confirmer|Signer)/ }),
  );
const inTable = (name: string) => within(screen.getByRole('table', { name }));

describe('écran Immobilier (#259)', () => {
  it('sans bien ni bail : les états vides mènent aux biens offerts, foyer sur leur titre (#866)', async () => {
    state.views = { ...state.views, my_properties: [], my_leases: [] };
    await showProperty();
    expect(screen.getByRole('heading', { name: fr.property.noneMine })).toBeTruthy();
    expect(screen.getByRole('heading', { name: fr.property.noLeases })).toBeTruthy();
    const [toOffers] = screen.getAllByRole('button', { name: fr.property.seeOffers });
    fireEvent.click(toOffers as HTMLElement);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: fr.property.offers }));
    // Sans offre, rien vers quoi mener : la raison seule.
    cleanup();
    state.views = { ...state.views, city_properties: [], property_offers_upkeep: [] };
    await showProperty();
    expect(screen.getByRole('heading', { name: fr.property.noOffers })).toBeTruthy();
    expect(screen.queryByRole('button', { name: fr.property.seeOffers })).toBeNull();
  });

  it('achat à la cité et location d’une offre, chacun au prix vu', async () => {
    await showProperty();
    open(/^Acheter à la cité .* n° 1, Kallistè$/);
    // La feuille dit le prix, l'état et l'entretien ; la refermer n'achète rien.
    const sheet = screen.getByRole('dialog', { name: /^Acheter à la cité : .* n° 1, Kallistè$/ });
    expect(sheet.textContent).toContain('Entretien');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(api.propertyCommand).not.toHaveBeenCalled();
    open(/^Acheter à la cité .* n° 1, Kallistè$/);
    confirm();
    await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(1));
    await screen.findAllByRole('button', { name: /^Louer \(5 drachmes par jour\)/ });
    open(/^Louer \(5 drachmes par jour\)/);
    confirm();
    await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(2));
    expect(sent().map(([name, input]) => [name, input])).toEqual([
      ['property.buy', { propertyId: 'p1', expectedPriceOboles: townhouse?.purchasePriceOboles }],
      ['property.lease', { propertyId: 'p2', expectedRentOboles: 30 }],
    ]);
    expect(await screen.findByText(fr.property.done.lease)).toBeTruthy();
    // Le bouton cliqué n'a pas le foyer : le résultat, annoncé dans la carte des offres, le prend.
    await waitFor(() => expect(document.activeElement?.textContent).toBe(fr.property.done.lease));
    expect(document.activeElement?.getAttribute('role')).toBe('status');
  });

  it('achat au-delà de la trésorerie : inactif, ce qui manque dit et relié ; la location reste proposée (#864)', async () => {
    const price = townhouse?.purchasePriceOboles ?? 0;
    state.views['my_treasury'] = [{ balance: price - 6 }];
    await showProperty();
    const buy = screen.getAllByRole('button', { name: /^Acheter à la cité/ })[0] as HTMLElement;
    expect(buy.getAttribute('aria-disabled')).toBe('true');
    const why = document.getElementById(buy.getAttribute('aria-describedby') ?? '');
    expect(why?.textContent).toBe('Il manque 1 drachme à votre trésorerie.');
    fireEvent.click(buy);
    expect(screen.queryByRole('dialog')).toBeNull();
    const rent = screen.getAllByRole('button', { name: /^Louer/ })[0] as HTMLElement;
    expect(rent.hasAttribute('aria-disabled')).toBe(false);
    // La trésorerie au prix : l'achat redevient possible.
    cleanup();
    state.views['my_treasury'] = [{ balance: price }];
    await showProperty();
    open(/^Acheter à la cité/);
    expect(screen.getByRole('dialog', { name: /^Acheter à la cité/ })).toBeTruthy();
  });

  it('sans réponse : le nouvel essai rejoue la même clé ; un refus est dit, la clé suivante est neuve', async () => {
    api.propertyCommand
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: 'lost' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'PRICE_CHANGED', message: 'x' } });
    await showProperty();
    open(/^Acheter à la cité/);
    // La feuille reste ouverte après une réponse perdue ou un refus, dit près de son bouton.
    const sheet = within(screen.getByRole('dialog'));
    for (const [times, said] of [
      [1, fr.errors.INTERNAL],
      [2, fr.errors.PRICE_CHANGED],
      [3, ''],
    ] as const) {
      await waitFor(() =>
        expect(sheet.getByRole('button', { name: /^Confirmer/ }).hasAttribute('disabled')).toBe(
          false,
        ),
      );
      confirm();
      await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(times));
      if (said) await waitFor(() => expect(sheet.getByRole('alert').textContent).toBe(said));
    }
    const keys = sent().map(([, , key]) => key);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('mon bien : état, entretien impayé, mon offre sans bouton ; lecture en échec : annoncée', async () => {
    state.views['my_properties'] = [
      { ...mine, id: 'p2', lot: 2, upkeep_unpaid_since: '2026-11-16T03:00:00Z' },
    ];
    await showProperty();
    const row = within(inTable(fr.property.mine).getByRole('row', { name: /n° 2, Kallistè/ }));
    expect(row.getAllByRole('cell')[0]?.textContent).toMatch(/^60\s%$/);
    expect(row.getByText(/^Entretien impayé depuis le/)).toBeTruthy();
    expect(inTable(fr.property.offers).getByText(fr.property.yourOffer)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Louer/ })).toBeNull();
    cleanup();
    state.views['my_properties'] = null;
    await showProperty();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });
  it('offre d’un bien impayé (#403) : l’impayé et son jour de jeu, en fr et en en, décrits au bouton', async () => {
    const offer = { ...mine, condition: 8000, upkeep_unpaid: true, kind: 'sale' };
    state.views['property_offers_upkeep'] = [
      { ...offer, property_id: 'p3', lot: 3, price_oboles: 900, upkeep_unpaid_day: 20_773 },
      { ...offer, property_id: 'p4', lot: 4, price_oboles: 800, upkeep_unpaid_day: null },
      {
        ...offer,
        property_id: 'p6',
        lot: 6,
        price_oboles: 700,
        upkeep_unpaid: false,
        upkeep_unpaid_day: null,
      },
    ];
    await showProperty();
    // Le tableau marque les offres impayées ; la feuille en dit le jour, et décrit le bouton qui confirme.
    const unpaid = (lot: number) =>
      within(
        inTable(fr.property.offers).getByRole('row', { name: new RegExp(`n° ${lot},`) }),
      ).queryByText(fr.property.unpaidBadge);
    expect([3, 4, 6].map((lot) => unpaid(lot) !== null)).toEqual([true, true, false]);
    const confirmButton = () =>
      within(screen.getByRole('dialog')).getByRole('button', { name: /^Confirmer/ });
    const sheetFor = (lot: number) => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      open(new RegExp(`^(Acheter|Buy) \\(.* ${lot}, Kallistè$`));
    };
    sheetFor(3);
    const dated = screen.getByText(
      "Entretien impayé depuis le 16 nov. 2026 : ce bien ne loge personne jusqu'à ce qu'une clôture paie son entretien.",
    );
    expect(confirmButton().getAttribute('aria-describedby')).toBe(dated.id);
    sheetFor(4);
    expect(screen.getAllByText(fr.property.offerUnpaidUndated)).toHaveLength(1);
    sheetFor(6);
    expect(confirmButton().getAttribute('aria-describedby')).toBeNull();
    cleanup();
    await showProperty('en');
    sheetFor(3);
    expect(
      screen.getByText(
        'Upkeep unpaid since Nov 16, 2026: this property houses no one until a close pays its upkeep.',
      ),
    ).toBeTruthy();
    sheetFor(4);
    expect(screen.getAllByText(en.property.offerUnpaidUndated)).toHaveLength(1);
  });
  it('mes baux : fin demandée, bail résilié, fin du bail', async () => {
    state.views['my_leases'] = [
      lease,
      { ...lease, id: 'l2', lot: 6, end_requested_at: '2026-11-16T10:00:00Z' },
      {
        ...lease,
        id: 'l3',
        lot: 7,
        ended_at: '2026-11-15T03:00:00Z',
        ended_day: 1,
        end_reason: 'unpaid',
      },
    ];
    await showProperty();
    // Le tableau des baux (les fiches sur téléphone portent les mêmes valeurs).
    const leases = inTable(fr.property.leases);
    expect(leases.getByText(fr.property.ending)).toBeTruthy();
    expect(leases.getByText(fr.property.ended.unpaid)).toBeTruthy();
    expect(leases.getAllByText(fr.property.tenant)).toHaveLength(3);
    // Un seul bail en cours sans fin demandée : un seul bouton.
    expect(leases.getAllByRole('button', { name: /^Mettre fin au bail/ })).toHaveLength(1);
    open(/^Mettre fin au bail/);
    expect(screen.getByRole('dialog').textContent).toContain(fr.property.endNote);
    confirm();
    await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(1));
    expect(sent()[0]?.slice(0, 2)).toEqual(['property.endLease', { leaseId: 'l1' }]);
    // La feuille fermée, le foyer va au résultat, annoncé sous le titre des baux.
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe(fr.property.done.endLease),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fin de bail sans réponse puis refusée : la feuille reste ouverte, le nouvel essai garde la clé', async () => {
    api.propertyCommand
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: 'lost' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'PRICE_CHANGED', message: 'x' } });
    await showProperty();
    open(/^Mettre fin au bail/);
    const sheet = within(screen.getByRole('dialog'));
    const said = async (text: string) => {
      await waitFor(() => expect(sheet.getByRole('alert').textContent).toBe(text));
      await waitFor(() =>
        expect(sheet.getByRole('button', { name: /^Confirmer/ }).hasAttribute('disabled')).toBe(
          false,
        ),
      );
    };
    // Région d'alerte présente avant le refus, près du bouton.
    expect(sheet.getByRole('alert').textContent).toBe('');
    confirm();
    await said(fr.errors.INTERNAL);
    confirm();
    await said(fr.errors.PRICE_CHANGED);
    const keys = sent().map(([, , key]) => key);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    // Rien n'est annoncé hors de la feuille, qui reste ouverte.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
