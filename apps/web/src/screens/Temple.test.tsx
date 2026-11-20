// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  useClockRules: () => ({ rules: null }),
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
      fr.temple.pythia.consulted,
    ]);
    // Le taux, commun aux dieux qui déclinent, n'est dit qu'une fois, sous le titre (#869).
    expect(
      screen.getByText(
        /^Chaque Charis décline de 1\s?% par jour à la clôture, arrondi vers zéro ; un dieu sans déclin dit ne perd rien/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/^Déclin du jour : −12 à la prochaine clôture\.$/)).toBeTruthy();
    // Athéna (99 Charis) ne perd rien : rien n'est dit sous elle, la règle l'a dit une fois.
    expect(screen.queryByText(/rien à la prochaine clôture/)).toBeNull();
    expect(screen.getAllByText(/^Déclin du jour/)).toHaveLength(1);
    expect(screen.queryAllByText(/par jour/)).toHaveLength(1);
    expect(screen.getByText(fr.temple.charis.noDecay)).toBeTruthy();
    expect(
      screen.getByText(/^Charis de Kallistè envers Athéna, son dieu protecteur : 4\s200$/),
    ).toBeTruthy();
    expect(screen.getByText(fr.temple.city.metic)).toBeTruthy();
  });

  it('des taux de déclin différents restent dits dieu par dieu (#869)', async () => {
    state.rules = {
      gods: GODS.map((god) => (god.id === 'athena' ? { ...god, dailyDecayBps: 200 } : god)),
    };
    state.views = { my_favor: [{ house_id: 'h1', god_id: 'demeter', charis: 1250 }] };
    await show();
    expect(screen.queryByText(/^Chaque Charis décline/)).toBeNull();
    expect(
      screen.getByText(/^Déclin du jour : −12 à la prochaine clôture \(1\s?% par jour\)\.$/),
    ).toBeTruthy();
    expect(
      screen.getByText(/^Déclin du jour : rien à la prochaine clôture \(2\s?% par jour/),
    ).toBeTruthy();
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
    expect(screen.queryByRole('heading', { name: /^Déméter :/ })).toBeNull();
    cleanup();
    state.rulesFailed = true;
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });

  it('la carte d’un dieu ouvre la feuille d’offrande sur ce dieu ; Échap la referme', async () => {
    state.rules = { gods: GODS };
    await show();
    const opener = screen.getByRole('button', { name: 'Faire une offrande à Athéna' });
    // Un bouton par dieu qui accepte un don.
    expect(screen.getAllByRole('button', { name: /^Faire une offrande à / })).toHaveLength(3);
    opener.focus();
    fireEvent.click(opener);
    const sheet = screen.getByRole('dialog', { name: fr.temple.offering.title });
    expect((within(sheet).getByRole('combobox') as HTMLSelectElement).value).toBe('athena');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
