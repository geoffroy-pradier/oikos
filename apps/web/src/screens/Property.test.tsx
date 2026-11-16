// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
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
  api.propertyCommand.mockReset();
  api.propertyCommand.mockResolvedValue({ ok: true, data: {}, replayed: false });
  state.views = {
    property_rules: [{ properties: config.properties }],
    city_properties: [
      { id: 'p1', city_id: 'c1', size_id: 'townhouse', lot: 1, for_sale: true, condition: 10000 },
    ],
    property_offers: [
      { ...mine, property_id: 'p2', lot: 2, condition: 8000, kind: 'lease', price_oboles: 30 },
    ],
    my_properties: [mine],
    my_leases: [lease],
  };
});
afterEach(cleanup);
const sent = () => api.propertyCommand.mock.calls.map((call) => [call[0], call[1], call[3]]);

describe('écran Immobilier (#259)', () => {
  it('achat à la cité et location d’une offre, chacun au prix vu', async () => {
    await showProperty();
    fireEvent.click(screen.getByRole('button', { name: /^Acheter à la cité .* n° 1, Kallistè$/ }));
    await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /^Louer \(5 drachmes par jour\)/ }));
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

  it('sans réponse : le nouvel essai rejoue la même clé ; un refus est dit, la clé suivante est neuve', async () => {
    api.propertyCommand
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: 'lost' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'PRICE_CHANGED', message: 'x' } });
    await showProperty();
    const buy = () => screen.getByRole('button', { name: /^Acheter à la cité/ });
    for (const times of [1, 2, 3]) {
      fireEvent.click(buy());
      await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(times));
      if (times === 2) expect(await screen.findByText(fr.errors.PRICE_CHANGED)).toBeTruthy();
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
    expect(screen.getByText('État : 60 %')).toBeTruthy();
    expect(screen.getByText(/^Entretien impayé depuis le/)).toBeTruthy();
    expect(screen.getByText(fr.property.yourOffer)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Louer/ })).toBeNull();
    cleanup();
    state.views['my_properties'] = null;
    await showProperty();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
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
    expect(screen.getByText(fr.property.ending)).toBeTruthy();
    expect(screen.getByText(fr.property.ended.unpaid)).toBeTruthy();
    // Un seul bail en cours sans fin demandée : un seul bouton.
    const end = screen.getAllByRole('button', { name: /^Mettre fin au bail/ });
    expect(end).toHaveLength(1);
    fireEvent.click(end[0] as HTMLElement);
    await waitFor(() => expect(api.propertyCommand).toHaveBeenCalledTimes(1));
    expect(sent()[0]?.slice(0, 2)).toEqual(['property.endLease', { leaseId: 'l1' }]);
  });
});
