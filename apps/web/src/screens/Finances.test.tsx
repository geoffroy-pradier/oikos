// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

// Écran Finances (#732) : lectures simulées vue par vue.
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
  useClockRules: () => ({ rules: null }),
}));
vi.mock('../HouseNav', () => ({ HouseNav: () => null }));
const { FinancesScreen } = await import('./Finances');

const loan = (extra = {}) => ({
  id: 'l1',
  lender: 'temple',
  principal: 6000,
  rate_bps: 1000,
  term_days: 30,
  interest: 50,
  due_day: 20_400,
  due_at: '2999-01-01T04:00:00+00:00',
  principal_repaid: 0,
  interest_repaid: 20,
  outstanding: 6030,
  status: 'active',
  ...extra,
});
const plain = (node: HTMLElement | null) => node?.textContent?.replace(/[\u00a0\u202f]/g, ' ');

async function show(lng: 'fr' | 'en' = 'fr') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  const house = {
    id: 'h1',
    name: 'Test',
    cityId: 'c1',
    accessToken: 'jeton',
    cityName: 'Kallistè',
  };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'citizen' }}
      >
        <FinancesScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  state.views = {
    my_loans: [loan()],
    house_honor: [{ honor: 10, dishonored: false, dishonored_until_day: null }],
  };
});
afterEach(cleanup);

describe('écran Finances, dettes (#732)', () => {
  it('montre le prêteur, le reste dû en drachmes et oboles, l’échéance et les intérêts restants', async () => {
    await show();
    const card = within(document.querySelector('[data-loan="l1"]') as HTMLElement);
    expect(card.getByRole('heading', { name: 'Trésor du temple' })).toBeTruthy();
    expect(plain(card.getByText('Reste dû', { selector: 'dt' }).closest('div'))).toContain(
      '1 005 drachmes',
    );
    expect(card.getByText('Échéance', { selector: 'dt' })).toBeTruthy();
    expect(plain(card.getByText('Intérêts', { selector: 'dt' }).closest('div'))).toContain(
      '5 drachmes',
    );
    expect(plain(card.getByText(/^restants sur /))).toContain(
      "restants sur 8 drachmes 2 oboles, à 10 % l'an",
    );
    expect(card.getByText('En cours')).toBeTruthy();
    expect(screen.queryByText('Marque de déshonneur')).toBeNull();
  });

  it('un prêt échu pas encore prélevé le dit ; un prêt en défaut aussi', async () => {
    state.views['my_loans'] = [
      loan({ id: 'a', due_at: '2020-01-01T04:00:00+00:00' }),
      loan({ id: 'b', due_at: '2020-01-02T04:00:00+00:00', status: 'defaulted' }),
    ];
    await show();
    expect(
      within(document.querySelector('[data-loan="a"]') as HTMLElement).getByText('Échu'),
    ).toBeTruthy();
    expect(
      within(document.querySelector('[data-loan="b"]') as HTMLElement).getByText('En défaut'),
    ).toBeTruthy();
  });

  it('marque de déshonneur : tant qu’un prêt est en défaut, puis jusqu’à son dernier jour', async () => {
    state.views['house_honor'] = [{ honor: 0, dishonored: true, dishonored_until_day: null }];
    state.views['my_loans'] = [loan({ status: 'defaulted' })];
    const view = await show();
    expect(screen.getByRole('heading', { name: 'Marque de déshonneur' })).toBeTruthy();
    expect(screen.getByText(/tant qu'il n'est pas soldé/)).toBeTruthy();
    view.unmount();

    state.views['house_honor'] = [{ honor: 0, dishonored: true, dishonored_until_day: 20_500 }];
    state.views['my_loans'] = [];
    await show();
    const until = new Intl.DateTimeFormat('fr', { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(20_500 * 86_400_000),
    );
    expect(plain(screen.getByText(/^Votre maison porte une marque/))).toContain(
      `jusqu'au ${until.replace(/[\u00a0\u202f]/g, ' ')}`,
    );
  });

  it('sans dette : le dit ; lecture en échec : le dit et propose de relire, jamais « aucune dette »', async () => {
    state.views['my_loans'] = [];
    const view = await show();
    expect(screen.getByText('Aucune dette en cours.')).toBeTruthy();
    view.unmount();

    state.views['my_loans'] = null;
    await show();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
    expect(screen.queryByText('Aucune dette en cours.')).toBeNull();
  });

  it('une ligne illisible est une panne, pas une absence de dette', async () => {
    state.views['my_loans'] = [loan({ outstanding: 'x' })];
    await show();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
    expect(screen.queryByText('Aucune dette en cours.')).toBeNull();
  });

  it('en anglais : prêteur, états et unités', async () => {
    await show('en');
    expect(screen.getByRole('heading', { name: 'Temple Treasury' })).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(plain(screen.getByText('Still owed', { selector: 'dt' }).closest('div'))).toContain(
      '1,005 drachmas',
    );
  });
});
