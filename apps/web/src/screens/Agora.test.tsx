// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

const state = vi.hoisted(() => ({
  stock: [] as { city_id: string; good_id?: string; quantity?: number; reserved?: number }[],
  sites: [] as { city_id: string }[],
  reads: [] as { view: string; filters: Record<string, unknown> }[],
  // Lignes rendues par vue : comme la vraie lecture, elles ne changent qu'à une relecture.
  seen: new Map<string, unknown[]>(),
}));
const api = vi.hoisted(() => ({ placeOrder: vi.fn(), cancelOrder: vi.fn() }));
vi.mock('../api', () => ({ placeOrder: api.placeOrder, cancelOrder: api.cancelOrder }));
vi.mock('../data', () => ({
  // En-tête de page : horloge du monde inconnue, l'heure seule.
  useClockRules: () => ({ rules: null }),
  useRows: (view: string, _columns: string, _order: string, filters: Record<string, unknown>) => {
    state.reads.push({ view, filters });
    const source = () =>
      view === 'my_inventories'
        ? state.stock
        : view === 'my_sites'
          ? state.sites
          : view === 'market_rules'
            ? [{ market_tax: { rateBps: 0 }, price_history: { candleSeconds: 3600 } }]
            : [];
    if (!state.seen.has(view)) state.seen.set(view, source());
    const reload = () => {
      state.seen.set(view, source());
      return Promise.resolve(state.seen.get(view));
    };
    return { rows: state.seen.get(view), failed: false, reload };
  },
}));
vi.mock('./PriceHistory', () => ({
  usePriceHistory: (cityId: string) => ({ cityId }),
  PriceQuote: () => null,
  PriceChart: (props: { history: { cityId: string } }) => (
    <p data-testid="history">{props.history.cityId}</p>
  ),
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
  state.seen.clear();
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

  it('le choix du bien, et de la cité s’il y en a plusieurs, à droite de l’en-tête', async () => {
    state.stock = [{ city_id: ELAIA }];
    await show();
    const title = screen.getByRole('heading', { level: 1, name: 'Agora de Kallistè' });
    const header = title.closest<HTMLElement>('[data-slot="page-header"]');
    if (!header) throw new Error('en-tête');
    for (const label of [fr.agora.good, 'Cité du marché']) {
      expect(
        within(header).getByLabelText(label).closest('[data-slot="page-header-action"]'),
      ).toBeTruthy();
      // Libellé lu, pas affiché : la liste reste sur la ligne du titre.
      expect(within(header).getByText(label).className).toBe('sr-only');
    }
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
    state.stock = [{ city_id: ELAIA, good_id: 'wheat', quantity: 40, reserved: 0 }];
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
    // L'ordre se saisit dans la feuille de vente : quantité et prix, puis le récapitulatif.
    fireEvent.click(screen.getByRole('button', { name: 'Vendre' }));
    fireEvent.change(screen.getByLabelText('Prix limite par unité (oboles)'), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByLabelText('Quantité', { exact: true }), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
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

describe('feuille d’ordre de l’agora', () => {
  it('sans ordre en attente : l’état vide ouvre la feuille d’achat (#866)', async () => {
    await show();
    expect(screen.getByRole('heading', { name: fr.agora.myOrdersEmpty })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: fr.agora.myOrdersAction }));
    expect(await screen.findByRole('dialog', { name: 'Acheter : Blé' })).toBeTruthy();
  });

  const sell = async (quantity: string, price: string) => {
    fireEvent.change(screen.getByLabelText('Quantité', { exact: true }), {
      target: { value: quantity },
    });
    fireEvent.change(screen.getByLabelText('Prix limite par unité (oboles)'), {
      target: { value: price },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    fireEvent.click(await screen.findByRole('button', { name: "Déposer l'ordre" }));
  };

  it('relit le stock libre à l’ouverture : un stock monté depuis la première lecture se vend', async () => {
    state.stock = [{ city_id: CITY, good_id: 'wheat', quantity: 10, reserved: 0 }];
    api.placeOrder.mockResolvedValue({
      ok: false,
      error: { code: 'INSUFFICIENT_STOCK', message: 'x' },
    });
    await show();
    // Récolte faite ailleurs entre-temps : la base a 40 blés, l'écran en a lu 10.
    state.stock = [{ city_id: CITY, good_id: 'wheat', quantity: 40, reserved: 0 }];
    fireEvent.click(screen.getByRole('button', { name: 'Vendre' }));
    expect(await screen.findByText('Stock libre à Kallistè : 40 × Blé.')).toBeTruthy();
    await sell('30', '20');
    await waitFor(() => expect(api.placeOrder).toHaveBeenCalledTimes(1));
    expect(api.placeOrder.mock.calls[0]?.[0]).toMatchObject({ side: 'sell', quantity: 30 });
  });

  it('même saisie restée sans réponse : même clé ; autre saisie : clé neuve', async () => {
    state.stock = [{ city_id: CITY, good_id: 'wheat', quantity: 40, reserved: 0 }];
    api.placeOrder.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'x' } });
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Vendre' }));
    await screen.findByText('Stock libre à Kallistè : 40 × Blé.');
    await sell('30', '20');
    await waitFor(() => expect(api.placeOrder).toHaveBeenCalledTimes(1));
    const submit = await screen.findByRole('button', { name: "Déposer l'ordre" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(api.placeOrder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    await sell('30', '21');
    await waitFor(() => expect(api.placeOrder).toHaveBeenCalledTimes(3));
    const [first, again, other] = api.placeOrder.mock.calls.map((call) => call[2] as string);
    expect(again).toBe(first);
    expect(other).not.toBe(first);
    expect(api.placeOrder.mock.calls[2]?.[0]).toMatchObject({ price: 21 });
  });
});
