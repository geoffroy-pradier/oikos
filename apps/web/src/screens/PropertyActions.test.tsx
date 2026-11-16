// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Écran Immobilier, commandes du propriétaire (#259) : lectures et commandes simulées.
const config = INITIAL_CONFIG as GameConfig;
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
const api = vi.hoisted(() => ({ propertyCommand: vi.fn() }));
vi.mock('../api', () => ({ propertyCommand: api.propertyCommand }));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
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
async function showProperty() {
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
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
      >
        <PropertyScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}
beforeEach(() => {
  api.propertyCommand.mockReset();
  api.propertyCommand.mockResolvedValue({ ok: true, data: {}, replayed: false });
  state.views = {
    property_rules: [{ properties: config.properties }],
    property_offers: [
      {
        property_id: 'p2',
        city_id: 'c1',
        size_id: 'townhouse',
        lot: 2,
        condition: 8000,
        kind: 'lease',
        price_oboles: 30,
      },
    ],
    my_properties: [mine],
  };
});
afterEach(cleanup);
const sent = () => api.propertyCommand.mock.calls.map((call) => [call[0], call[1], call[3]]);

describe('commandes du propriétaire (#259)', () => {
  it('rénovation au coût en vigueur, en oboles et en biens', async () => {
    await showProperty();
    fireEvent.click(screen.getByRole('button', { name: /^Rénover/ }));
    await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(1));
    expect(sent()[0]?.slice(0, 2)).toEqual([
      'property.renovate',
      {
        propertyId: 'p9',
        expectedCostOboles: townhouse?.renovation.oboles,
        expectedGoods: townhouse?.renovation.goods,
      },
    ]);
    expect(await screen.findByText(fr.property.done.renovate)).toBeTruthy();
  });

  it('mise en vente et en location au prix saisi ; sans prix valable, rien ne part', async () => {
    await showProperty();
    const sale = screen.getByRole('button', { name: /^Mettre en vente — Maison de ville n° 9/ });
    fireEvent.click(sale);
    const field = screen.getByRole('textbox', { name: /^Prix de vente ou loyer/ });
    fireEvent.change(field, { target: { value: '-3' } });
    fireEvent.click(sale);
    expect(api.propertyCommand).not.toHaveBeenCalled();
    expect(screen.getByText(fr.property.priceInvalid)).toBeTruthy();
    fireEvent.change(field, { target: { value: '500' } });
    fireEvent.click(sale);
    await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /^Mettre en location — / }));
    await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(2));
    expect(sent().map(([name, input]) => [name, input])).toEqual([
      ['property.listForSale', { propertyId: 'p9', priceOboles: 500 }],
      ['property.offerLease', { propertyId: 'p9', rentOboles: 500 }],
    ]);
  });
  it('une offre ouverte se retire ; un bien loué ne s’offre pas ; un bien neuf ne se rénove pas', async () => {
    state.views['my_properties'] = [
      { ...mine, id: 'p2', lot: 2, condition: 10000 },
      { ...mine, id: 'p5', lot: 5 },
    ];
    state.views['my_leases'] = [
      { id: 'l1', property_id: 'p5', city_id: 'c1', size_id: 'townhouse', lot: 5 },
    ]
      .map((row) => ({ ...row, tenant_house_id: 'h2', rent_oboles: 40, end_requested_at: null }))
      .map((row) => ({ ...row, ended_at: null, ended_day: null, end_reason: null }));
    await showProperty();
    expect(screen.getAllByRole('button', { name: /^Rénover/ })).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Retirer l'offre de location/ }));
    await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(1));
    expect(sent()[0]?.slice(0, 2)).toEqual(['property.withdrawOffer', { propertyId: 'p2' }]);
  });
});
