// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

// Proposition d'un décret par l'archonte (#264) : lectures simulées, commande espionnée.
const config = INITIAL_CONFIG as GameConfig;
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
const api = vi.hoisted(() => ({ cityCommand: vi.fn() }));
vi.mock('../api', () => ({ cityCommand: api.cityCommand }));
// Une relecture rend de nouveau l'écran, avec les vues telles qu'elles sont alors.
vi.mock('../data', async () => {
  const { useReducer } = await import('react');
  return {
    useRows: (view: string) => {
      const [, refresh] = useReducer((n: number) => n + 1, 0);
      const rows = view in state.views ? (state.views[view] ?? null) : [];
      return {
        rows,
        failed: rows === null,
        reload: () => {
          refresh();
          return Promise.resolve(rows);
        },
      };
    },
  };
});
const { DecreeForm } = await import('./DecreeForm');

const rules = Object.entries(config.decrees?.models ?? {}).map(([model, bounds]) => ({
  model,
  bounds,
  voting_days: 2,
  quorum_bps: 2000,
  max_open_per_city: 3,
  spending_cap_share_bps: 2500,
}));
const archon = {
  house_id: 'h1',
  office: 'archon',
  ends_at: '2099-01-01T00:00:00Z',
  in_office: true,
};
async function show(lng: 'fr' | 'en' = 'fr') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  const done = vi.fn(() => Promise.resolve());
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'citizen' }}
      >
        <DecreeForm onDone={done} />
      </HouseProvider>
    </I18nextProvider>,
  );
  // Archonte : la feuille de proposition s'ouvre (#697).
  const open = screen.queryByRole('button', { name: (lng === 'en' ? en : fr).decreeForm.open });
  if (open) fireEvent.click(open);
  return done;
}
/** Continuer, qui mène au récapitulatif : inactif tant que la saisie sort des bornes (#697). */
const next = (lng: typeof fr = fr) => screen.getByRole('button', { name: lng.stepper.next });
/** Choisit un modèle, puis passe à ses paramètres. */
const pick = (name: string, lng: typeof fr = fr) => {
  fireEvent.click(screen.getByRole('radio', { name }));
  fireEvent.click(next(lng));
};
/** Passe au récapitulatif, puis propose au vote. */
const propose = (lng: typeof fr = fr) => {
  fireEvent.click(next(lng));
  fireEvent.click(screen.getByRole('button', { name: lng.decreeForm.submit }));
};
const goodsGroup = () => screen.getByRole('group', { name: /^Biens de la fête/ });
/** Texte de la région qui décrit les biens de la fête, toujours présente. */
const goodsMessage = () =>
  document.getElementById(goodsGroup().getAttribute('aria-describedby') ?? '')?.textContent;
beforeEach(() => {
  api.cityCommand.mockReset();
  api.cityCommand.mockResolvedValue({ ok: true, data: {}, replayed: false });
});
afterEach(() => {
  cleanup();
  state.views = {};
});

describe('proposition d’un décret par l’archonte (#264)', () => {
  it('rien pour une maison qui n’est pas l’archonte en charge, ni sans modèle ouvert', async () => {
    state.views = { decree_rules: rules, offices: [{ ...archon, house_id: 'h2' }] };
    await show();
    expect(screen.queryByText(fr.decreeForm.title)).toBeNull();
    cleanup();
    state.views = { decree_rules: [], offices: [archon] };
    await show();
    expect(screen.queryByText(fr.decreeForm.title)).toBeNull();
  });

  it('taux de la taxe : bornes annoncées, saisie hors bornes refusée, puis proposée en points de base', async () => {
    state.views = { decree_rules: rules, offices: [archon] };
    const done = await show();
    expect(screen.getByText(/^Vote de 2 jours ; quorum de 20\s?% des citoyens/)).toBeTruthy();
    pick(fr.decreeForm.models.market_tax_rate);
    expect(screen.getByText(/^Entre 2\s?% et 10\s?%$/)).toBeTruthy();
    const rate = screen.getByLabelText(fr.decreeForm.rate);
    fireEvent.change(rate, { target: { value: '12' } });
    expect(screen.getByText(fr.decreeForm.outOfBounds)).toBeTruthy();
    expect(next()).toHaveProperty('disabled', true);
    fireEvent.click(next());
    expect(api.cityCommand).not.toHaveBeenCalled();
    fireEvent.change(rate, { target: { value: '7,5' } });
    propose();
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.slice(0, 3)).toEqual([
      'city.proposeDecree',
      { model: 'market_tax_rate', params: { rateBps: 750 } },
      't',
    ]);
    await waitFor(() => expect(document.activeElement?.textContent).toBe(fr.decreeForm.done));
    expect(done).toHaveBeenCalled();
  });

  it('fête : montant, durée et biens dans leurs bornes ; un refus de l’API est dit', async () => {
    api.cityCommand.mockResolvedValue({
      ok: false,
      error: { code: 'SPENDING_CAP_EXCEEDED', message: '' },
    });
    state.views = { decree_rules: rules, offices: [archon] };
    await show();
    pick(fr.decreeForm.models.festival);
    fireEvent.change(screen.getByLabelText(fr.decreeForm.amount), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText(fr.decreeForm.days), { target: { value: '2' } });
    expect(next()).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pain' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vin' }));
    propose();
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.[1]).toEqual({
      model: 'festival',
      params: { amountOboles: 600, days: 2, goodIds: ['bread', 'wine'] },
    });
    expect(await screen.findByText(fr.errors.SPENDING_CAP_EXCEEDED)).toBeTruthy();
  });
  it('chaque champ jugé seul : un montant de fête hors bornes est dit sous le montant, pas sous la durée', async () => {
    state.views = { decree_rules: rules, offices: [archon] };
    await show();
    pick(fr.decreeForm.models.festival);
    expect(
      screen.getByText(/^Entre 300 et 30\s000 oboles \(50 drachmes à 5\s?000 drachmes\)\.$/),
    ).toBeTruthy();
    const amount = screen.getByLabelText(fr.decreeForm.amount);
    const days = screen.getByLabelText(fr.decreeForm.days);
    fireEvent.change(amount, { target: { value: '99999999' } });
    fireEvent.change(days, { target: { value: '2' } });
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(days.getAttribute('aria-invalid')).toBeNull();
    fireEvent.change(amount, { target: { value: '600' } });
    expect(amount.getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByText(/Soit 100 drachmes\.$/)).toBeTruthy();
    for (const good of ['Pain', 'Vin', 'Poisson', "Huile d'olive"])
      fireEvent.click(screen.getByRole('checkbox', { name: good }));
    expect(goodsMessage()).toBe(fr.decreeForm.tooManyGoods);
    expect(goodsGroup().getAttribute('aria-invalid')).toBe('true');
    expect(next()).toHaveProperty('disabled', true);
  });

  it('fête sans bien coché : dit dans la région des biens, toujours présente et reliée au groupe', async () => {
    state.views = { decree_rules: rules, offices: [archon] };
    await show();
    pick(fr.decreeForm.models.festival);
    // Formulaire vierge : la région existe déjà, vide, et le groupe n'est pas fautif.
    expect(goodsMessage()).toBe('');
    expect(goodsGroup().getAttribute('aria-invalid')).toBeNull();
    fireEvent.change(screen.getByLabelText(fr.decreeForm.amount), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText(fr.decreeForm.days), { target: { value: '2' } });
    expect(goodsMessage()).toBe(fr.decreeForm.noGoods);
    expect(goodsGroup().getAttribute('aria-invalid')).toBe('true');
    expect(next()).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pain' }));
    expect(goodsMessage()).toBe('');
    expect(goodsGroup().getAttribute('aria-invalid')).toBeNull();
    expect(next()).toHaveProperty('disabled', false);
  });

  it('fête proposée : montant, durée et biens cochés remis à zéro', async () => {
    state.views = { decree_rules: rules, offices: [archon] };
    await show();
    pick(fr.decreeForm.models.festival);
    fireEvent.change(screen.getByLabelText(fr.decreeForm.amount), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText(fr.decreeForm.days), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pain' }));
    propose();
    expect(await screen.findByText(fr.decreeForm.done)).toBeTruthy();
    // La feuille fermée se rouvre vierge.
    fireEvent.click(screen.getByRole('button', { name: fr.decreeForm.open }));
    pick(fr.decreeForm.models.festival);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Pain' }).checked).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>(fr.decreeForm.amount).value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>(fr.decreeForm.days).value).toBe('');
    // Remis à zéro, le formulaire redevient vierge : aucun message sur les biens.
    expect(goodsMessage()).toBe('');
  });

  it('bornes jugées par le schéma de @oikos/contracts : le message suit le bouton', async () => {
    // Bornes lues plus larges que les plafonds du schéma (taux au plus 50 %) : le schéma l'emporte.
    const wide = rules.map((rule) =>
      rule.model === 'market_tax_rate'
        ? { ...rule, bounds: { minRateBps: 200, maxRateBps: 6000 } }
        : rule,
    );
    state.views = { decree_rules: wide, offices: [archon] };
    await show();
    pick(fr.decreeForm.models.market_tax_rate);
    const rate = screen.getByLabelText(fr.decreeForm.rate);
    fireEvent.change(rate, { target: { value: '55' } });
    expect(next()).toHaveProperty('disabled', true);
    expect(rate.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(fr.decreeForm.outOfBounds)).toBeTruthy();
    fireEvent.change(rate, { target: { value: '45' } });
    expect(rate.getAttribute('aria-invalid')).toBeNull();
    expect(next()).toHaveProperty('disabled', false);
  });

  it('lecture des charges ou des règles en échec : annoncée, sans formulaire', async () => {
    state.views = { decree_rules: rules, offices: null };
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
    cleanup();
    state.views = { decree_rules: null, offices: [archon] };
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
    expect(screen.queryByText(fr.decreeForm.title)).toBeNull();
  });

  it('lignes illisibles, charges ou règles : annoncées comme un échec de lecture', async () => {
    state.views = { decree_rules: rules, offices: [{ ...archon, in_office: 'oui' }] };
    await show();
    expect(screen.getByText(fr.app.loadFailed)).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
    cleanup();
    const unreadable = rules.map((rule) =>
      rule.model === 'festival' ? { ...rule, bounds: { minOboles: 'trois cents' } } : rule,
    );
    state.views = { decree_rules: unreadable, offices: [archon] };
    await show();
    expect(screen.getByText(fr.app.loadFailed)).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
    expect(screen.queryByText(fr.decreeForm.title)).toBeNull();
  });

  it('« Réessayer » réussi : le foyer va au titre « Proposer un décret »', async () => {
    state.views = { decree_rules: null, offices: [archon] };
    await show();
    const retry = screen.getByRole('button', { name: fr.app.retry });
    retry.focus();
    state.views = { decree_rules: rules, offices: [archon] };
    fireEvent.click(retry);
    const title = await screen.findByRole('heading', { name: fr.decreeForm.title });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('montant saisi avec séparateur des milliers, comme l’aide l’affiche : accepté (#456)', async () => {
    state.views = { decree_rules: rules, offices: [archon] };
    await show();
    pick(fr.decreeForm.models.public_works);
    const amount = screen.getByLabelText(fr.decreeForm.amount);
    // Tel que l'aide l'écrit (espace fine insécable), puis avec une espace ordinaire.
    fireEvent.change(amount, { target: { value: new Intl.NumberFormat('fr').format(1_500) } });
    expect(amount.getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByText(/Soit 250 drachmes\.$/)).toBeTruthy();
    fireEvent.change(amount, { target: { value: '1 500' } });
    propose();
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.[1]).toEqual({
      model: 'public_works',
      params: { amountOboles: 1_500 },
    });
  });

  it('saisie illisible : son propre message, pas « Hors des bornes » ; rien ne part (#456)', async () => {
    state.views = { decree_rules: rules, offices: [archon] };
    await show();
    pick(fr.decreeForm.models.market_tax_rate);
    const rate = screen.getByLabelText(fr.decreeForm.rate);
    fireEvent.change(rate, { target: { value: '5 %' } });
    expect(screen.getByText(fr.decreeForm.unreadable)).toBeTruthy();
    expect(screen.queryByText(fr.decreeForm.outOfBounds)).toBeNull();
    expect(rate.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(next());
    expect(api.cityCommand).not.toHaveBeenCalled();
    fireEvent.change(rate, { target: { value: '12' } });
    expect(screen.getByText(fr.decreeForm.outOfBounds)).toBeTruthy();
    expect(screen.queryByText(fr.decreeForm.unreadable)).toBeNull();
  });

  it('montant entier : « 30,000 » ou « 30.000 » refusé comme ambigu, même quand 30 tiendrait dans les bornes (#463)', async () => {
    // Bornes où N et N × 1 000 tiennent toutes deux : lu 30, le montant partirait mille fois trop petit.
    const wide = rules.map((rule) =>
      rule.model === 'public_works'
        ? { ...rule, bounds: { minOboles: 1, maxOboles: 60_000 } }
        : rule,
    );
    state.views = { decree_rules: wide, offices: [archon] };
    await show();
    pick(fr.decreeForm.models.public_works);
    const amount = screen.getByLabelText(fr.decreeForm.amount);
    for (const typed of ['30,000', '30.000', '1 234,500']) {
      fireEvent.change(amount, { target: { value: typed } });
      expect(screen.getByText(fr.decreeForm.ambiguous)).toBeTruthy();
      expect(screen.queryByText(fr.decreeForm.outOfBounds)).toBeNull();
      expect(amount.getAttribute('aria-invalid')).toBe('true');
      expect(screen.queryByText(/^Soit /)).toBeNull();
      expect(next()).toHaveProperty('disabled', true);
      fireEvent.click(next());
    }
    expect(api.cityCommand).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: '30 000' } });
    expect(screen.queryByText(fr.decreeForm.ambiguous)).toBeNull();
    propose();
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.[1]).toEqual({
      model: 'public_works',
      params: { amountOboles: 30_000 },
    });
  });

  it('montant et durée entiers : une saisie décimale dit « nombre entier attendu », pas « Hors des bornes » (#463)', async () => {
    state.views = { decree_rules: rules, offices: [archon] };
    await show();
    pick(fr.decreeForm.models.festival);
    const amount = screen.getByLabelText(fr.decreeForm.amount);
    const days = screen.getByLabelText(fr.decreeForm.days);
    fireEvent.change(amount, { target: { value: '300,5' } });
    fireEvent.change(days, { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pain' }));
    expect(screen.getAllByText(fr.decreeForm.notInteger)).toHaveLength(2);
    expect(screen.queryByText(fr.decreeForm.outOfBounds)).toBeNull();
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(days.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(next());
    expect(api.cityCommand).not.toHaveBeenCalled();
    // Au-delà des bornes, un nombre entier reste « Hors des bornes ».
    fireEvent.change(days, { target: { value: '30' } });
    expect(screen.getByText(fr.decreeForm.outOfBounds)).toBeTruthy();
    fireEvent.change(amount, { target: { value: '300' } });
    fireEvent.change(days, { target: { value: '2' } });
    propose();
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.[1]).toEqual({
      model: 'festival',
      params: { amountOboles: 300, days: 2, goodIds: ['bread'] },
    });
  });

  it('champs décimaux inchangés : un taux « 7,500 » se lit 7,5 % (#463)', async () => {
    state.views = { decree_rules: rules, offices: [archon] };
    await show();
    pick(fr.decreeForm.models.market_tax_rate);
    fireEvent.change(screen.getByLabelText(fr.decreeForm.rate), { target: { value: '7,500' } });
    expect(screen.queryByText(fr.decreeForm.ambiguous)).toBeNull();
    propose();
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.[1]).toEqual({
      model: 'market_tax_rate',
      params: { rateBps: 750 },
    });
  });

  it('en anglais : « 30.000 » ambigu, « 30,000 » lu comme trente mille ; messages en anglais (#463)', async () => {
    state.views = { decree_rules: rules, offices: [archon] };
    await show('en');
    pick(en.decreeForm.models.public_works, en);
    const amount = screen.getByLabelText(en.decreeForm.amount);
    fireEvent.change(amount, { target: { value: '30.000' } });
    expect(screen.getByText(en.decreeForm.ambiguous)).toBeTruthy();
    fireEvent.change(amount, { target: { value: '600.5' } });
    expect(screen.getByText(en.decreeForm.notInteger)).toBeTruthy();
    fireEvent.click(next(en));
    expect(api.cityCommand).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: '30,000' } });
    propose(en);
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.[1]).toEqual({
      model: 'public_works',
      params: { amountOboles: 30_000 },
    });
  });

  it('feuille par étapes : modèle décrit, paramètres, récapitulatif chiffré ; Retour garde la saisie (#697)', async () => {
    state.views = { decree_rules: rules, offices: [archon] };
    await show();
    const works = screen.getByRole('radio', { name: fr.decreeForm.models.public_works });
    const about = document.getElementById(works.getAttribute('aria-describedby') ?? '');
    expect(about?.textContent).toBe(fr.decreeForm.about.public_works);
    pick(fr.decreeForm.models.public_works);
    expect(screen.getByRole('heading', { name: /Paramètres$/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(fr.decreeForm.amount), { target: { value: '1 500' } });
    fireEvent.click(next());
    expect(screen.getByRole('heading', { name: /Récapitulatif$/ })).toBeTruthy();
    const recap = screen.getByText(fr.decreeForm.recap.amountOboles, {
      selector: 'dt',
    }).parentElement;
    expect(recap?.querySelector('dd')?.textContent).toBe('250 drachmes');
    fireEvent.click(screen.getByRole('button', { name: fr.stepper.back }));
    expect(screen.getByLabelText<HTMLInputElement>(fr.decreeForm.amount).value).toBe('1 500');
    expect(api.cityCommand).not.toHaveBeenCalled();
  });
});
