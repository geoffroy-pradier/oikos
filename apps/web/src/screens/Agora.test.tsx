// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

const state = vi.hoisted(() => ({
  stock: [] as { city_id: string }[],
  sites: [] as { city_id: string }[],
  reads: [] as { view: string; filters: Record<string, unknown> }[],
}));
const api = vi.hoisted(() => ({ placeOrder: vi.fn(), cancelOrder: vi.fn() }));
vi.mock('../api', () => ({ placeOrder: api.placeOrder, cancelOrder: api.cancelOrder }));
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, _order: string, filters: Record<string, unknown>) => {
    state.reads.push({ view, filters });
    const rows =
      view === 'my_inventories'
        ? state.stock
        : view === 'my_sites'
          ? state.sites
          : view === 'market_rules'
            ? [{ market_tax: { rateBps: 0 }, price_history: { candleSeconds: 3600 } }]
            : [];
    return { rows, failed: false, reload: () => Promise.resolve(rows) };
  },
}));
vi.mock('./PriceHistory', () => ({
  PriceHistory: (props: { cityId: string }) => <p data-testid="history">{props.cityId}</p>,
}));
vi.mock('../market-rules', () => ({
  cityMarketTax: () => ({ rateBps: 0 }),
  parseMarketTax: () => ({ rateBps: 0 }),
  previewSale: () => null,
}));
vi.mock('../price-history', () => ({ parseCandleSeconds: () => 3600 }));
const { AgoraScreen } = await import('./Agora');

const CITY = '11111111-1111-4111-8111-111111111111';
const ELAIA = '22222222-2222-4222-8222-222222222222';
async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: CITY, accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{
          ...house,
          cityNames: { [CITY]: 'Kallistè', [ELAIA]: 'Elaia' },
          citizenshipStatus: 'metic',
        }}
      >
        <AgoraScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const lastBook = () => state.reads.filter((read) => read.view === 'order_book').at(-1);

beforeEach(() => {
  state.stock = [];
  state.sites = [];
  state.reads = [];
  api.placeOrder.mockReset();
});
afterEach(cleanup);

describe('choix de la cité de l’agora', () => {
  it('sans stock ni site ailleurs : pas de choix, la cité d’origine', async () => {
    state.stock = [{ city_id: CITY }];
    await show();
    expect(screen.queryByLabelText('Cité du marché')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Agora de Kallistè' })).toBeTruthy();
  });

  it('propose les cités du stock et des sites, sans doublon, l’origine par défaut', async () => {
    state.stock = [{ city_id: ELAIA }, { city_id: ELAIA }];
    state.sites = [{ city_id: CITY }];
    await show();
    const select = screen.getByLabelText('Cité du marché') as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(['Kallistè', 'Elaia']);
    expect(select.value).toBe(CITY);
    expect(lastBook()?.filters).toMatchObject({ city_id: CITY });
  });

  it('carnet, historique et ordres suivent la cité choisie, et l’ordre part avec elle', async () => {
    state.stock = [{ city_id: ELAIA }];
    api.placeOrder.mockResolvedValue({
      ok: false,
      error: { code: 'INSUFFICIENT_STOCK', message: 'x' },
    });
    await show();
    fireEvent.change(screen.getByLabelText('Cité du marché'), { target: { value: ELAIA } });
    expect(screen.getByRole('heading', { name: 'Agora de Elaia' })).toBeTruthy();
    expect(screen.getByTestId('history').textContent).toBe(ELAIA);
    expect(lastBook()?.filters).toMatchObject({ city_id: ELAIA });
    expect(state.reads.filter((read) => read.view === 'my_orders').at(-1)?.filters).toMatchObject({
      city_id: ELAIA,
    });
    fireEvent.change(screen.getByLabelText('Prix limite par unité (oboles)'), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByLabelText('Quantité', { exact: true }), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: "Déposer l'ordre" }));
    await waitFor(() => expect(api.placeOrder).toHaveBeenCalled());
    expect(api.placeOrder.mock.calls[0]?.[0]).toMatchObject({
      cityId: ELAIA,
      side: 'sell',
      price: 20,
      quantity: 30,
    });
  });
});
