// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

// Flux de trésorerie de l'écran Comptes (#272) : lecture simulée.
const state = vi.hoisted(() => ({ rows: [] as unknown[] | null, args: [] as unknown[] }));
vi.mock('../data', () => ({
  useRows: (...args: unknown[]) => {
    state.args = args;
    return { rows: state.rows, failed: state.rows === null, reload: () => Promise.resolve(null) };
  },
}));
const { CashFlows } = await import('./CashFlows');

async function show(lng = 'fr') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        <CashFlows />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const flow = (nature: string, amount: number) => ({
  house_id: 'h1',
  account: 'treasury',
  game_day: 20406,
  nature,
  amount,
});
afterEach(() => {
  cleanup();
  state.rows = [];
});

describe('flux de trésorerie (#272)', () => {
  it('la nature offerings est libellée, en français et en anglais ; la lecture se borne aux derniers jours', async () => {
    state.rows = [flow('offerings', -60), flow('sales', 66)];
    await show();
    expect(screen.getByText('Offrandes et consultations de la Pythie : −10 drachmes')).toBeTruthy();
    expect(screen.getByText('Ventes, au brut : 11 drachmes')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toMatch(/2025 : net 1 drachme$/);
    expect(state.args.slice(2)).toEqual([
      'game_day',
      { house_id: 'h1', account: 'treasury' },
      { limit: 91 },
    ]);
    cleanup();
    await show('en');
    expect(screen.getByText('Offerings and Pythia consultations: −10 drachmas')).toBeTruthy();
  });

  it('aucun mouvement ; une nature inconnue dite par son nom ; une lecture en échec annoncée', async () => {
    await show();
    expect(screen.getByText(fr.accounts.flows.none)).toBeTruthy();
    cleanup();
    state.rows = [flow('future_nature', 6)];
    await show();
    expect(screen.getByText('Mouvements « future_nature » : 1 drachme')).toBeTruthy();
    cleanup();
    state.rows = null;
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });
});
