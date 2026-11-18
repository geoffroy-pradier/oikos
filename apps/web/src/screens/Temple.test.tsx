// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider, type HouseSummary } from '../house';
import fr from '../locales/fr.json';
import { parseTempleRules } from '../temple';

// Écran du temple (#272) : lectures simulées, vue par vue.
const state = vi.hoisted(() => ({
  views: {} as Record<string, unknown[] | null>,
  rules: null as unknown,
  rulesFailed: false,
}));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
  useTempleRules: () => ({
    rules: state.rulesFailed ? null : parseTempleRules(state.rules),
    failed: state.rulesFailed,
    reload: () => Promise.resolve(),
  }),
}));
const { TempleScreen } = await import('./Temple');

const GODS = [
  { id: 'demeter', charisPerObole: 1, charisPerUnit: { wheat: 5 }, dailyDecayBps: 100 },
  { id: 'athena', charisPerObole: 1, dailyDecayBps: 100 },
  { id: 'apollo', charisPerObole: 1 },
];
async function show(status: HouseSummary['citizenshipStatus'] = 'metic') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: status }}>
        <TempleScreen />
      </HouseProvider>
    </I18nextProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.views = {};
  state.rules = null;
  state.rulesFailed = false;
});

describe('écran du temple : Charis (#272)', () => {
  it('Charis par dieu avec le déclin du jour ; Charis de la cité envers son dieu protecteur', async () => {
    state.rules = { gods: GODS };
    state.views = {
      my_favor: [
        { house_id: 'h1', god_id: 'demeter', charis: 1250 },
        { house_id: 'h1', god_id: 'athena', charis: 99 },
      ],
      city_charis: [{ city_id: 'c1', god_id: 'athena', charis: 4200 }],
    };
    await show();
    const gods = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent?.replace(/\s/g, ' '));
    expect(gods).toEqual([
      'Déméter : 1 250 Charis',
      'Athéna : 99 Charis',
      'Apollon : 0 Charis',
      fr.temple.city.title,
    ]);
    expect(
      screen.getByText(/^Déclin du jour : −12 à la prochaine clôture \(1\s?% par jour\)\.$/),
    ).toBeTruthy();
    expect(screen.getByText(/^Déclin du jour : rien à la prochaine clôture/)).toBeTruthy();
    expect(screen.getByText(fr.temple.charis.noDecay)).toBeTruthy();
    expect(
      screen.getByText(/^Charis de Kallistè envers Athéna, son dieu protecteur : 4\s200$/),
    ).toBeTruthy();
    expect(screen.getByText(fr.temple.city.metic)).toBeTruthy();
  });

  it('cité sans dieu protecteur ; citoyenne, sa Charis compte', async () => {
    state.rules = { gods: GODS };
    await show('citizen');
    expect(screen.getByText(/^Kallistè n'a pas de dieu protecteur/)).toBeTruthy();
    cleanup();
    state.views = { city_charis: [{ city_id: 'c1', god_id: 'athena', charis: 0 }] };
    await show('citizen');
    expect(screen.getByText(fr.temple.city.citizen)).toBeTruthy();
  });

  it('une lecture en échec ou illisible est annoncée, jamais prise pour une Charis nulle', async () => {
    state.rules = { gods: GODS };
    state.views = { my_favor: [{ house_id: 'h1', god_id: 'demeter', charis: 'beaucoup' }] };
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
    expect(screen.queryByText(/^Déméter/)).toBeNull();
    cleanup();
    state.rulesFailed = true;
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });
});
