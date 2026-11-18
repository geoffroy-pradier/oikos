// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import type { Steward } from '../stewards';

// Section Intendant de la fiche d'un site (#278) : commandes espionnées, aucune lecture.
const api = vi.hoisted(() => ({ stewardCommand: vi.fn() }));
vi.mock('../api', () => ({ stewardCommand: api.stewardCommand }));
const { SiteSteward } = await import('./SiteSteward');

// Le moulin de la configuration initiale : du blé en intrant, de la farine en extrant.
const mill = (INITIAL_CONFIG as GameConfig).recipes.find((recipe) => recipe.id === 'mill_flour');
const posts = { limit: 2, dailyWageOboles: 8, rulesPerSteward: 3 };
const nikias: Steward = {
  id: 'st1',
  siteId: 's1',
  name: 'Nikias',
  state: 'active',
  since: null,
  revision: 1,
  rules: [{ kind: 'sell', goodId: 'flour', minPriceOboles: 14, keepUnits: 20 }],
};
const onChanged = vi.fn(() => Promise.resolve());
async function show(
  steward: Steward | undefined,
  options: { posted?: number; rules?: typeof posts } = {},
) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        <SiteSteward
          siteId="s1"
          siteName="Moulin"
          recipe={mill ?? null}
          steward={steward}
          rules={options.rules ?? posts}
          posted={options.posted ?? (steward ? 1 : 0)}
          onChanged={onChanged}
        />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const ok = (data: object) => ({ ok: true, replayed: false, data });
beforeEach(() => {
  api.stewardCommand.mockReset();
  onChanged.mockClear();
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('section Intendant (#278)', () => {
  it('embauche : le salaire est annoncé, la commande part, le résultat est dit et relu', async () => {
    api.stewardCommand.mockResolvedValue(ok({ stewardId: 'st1', name: 'Kléon' }));
    await show(undefined);
    expect(screen.getByText(/Son salaire, 1 drachme 2 oboles par jour/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Embaucher un intendant pour Moulin' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.stewardCommand).toHaveBeenCalledWith(
      'steward.hire',
      { siteId: 's1' },
      't',
      expect.any(String),
    );
    expect(screen.getByRole('status').textContent).toMatch(/^Kléon entre à votre service/);
  });

  it('sans poste libre, ou sans poste du tout, aucune embauche n’est proposée', async () => {
    await show(undefined, { posted: 2 });
    expect(screen.getByText("Vos 2 postes d'intendant sont pris.")).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    await show(undefined, { rules: { ...posts, limit: 0 } });
    expect(screen.getByText("Votre siège n'a aucun poste d'intendant.")).toBeTruthy();
  });

  it('règles : le formulaire saisit la grammaire, au clavier, et envoie les règles dans leur ordre', async () => {
    api.stewardCommand.mockResolvedValue(ok({ stewardId: 'st1', rules: [] }));
    await show(nikias);
    expect(screen.getByText(/^Nikias mène ses règles/)).toBeTruthy();
    expect(
      (screen.getByLabelText("Prix plancher (oboles l'unité)") as HTMLInputElement).value,
    ).toBe('14');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une règle (au plus 3)' }));
    const [, kind] = screen.getAllByLabelText('Geste');
    fireEvent.change(kind as HTMLElement, { target: { value: 'buy' } });
    // Le rachat ne propose que les intrants du moulin.
    const goods = screen.getAllByLabelText('Bien')[1] as HTMLSelectElement;
    expect([...goods.options].map((option) => option.value)).toEqual(['wheat']);
    fireEvent.change(screen.getByLabelText("Prix plafond (oboles l'unité)"), {
      target: { value: '7' },
    });
    // Saisie incomplète : la règle fautive est nommée, rien ne part.
    expect(screen.getByRole('alert').textContent).toBe(
      'La règle 2 est incomplète, hors bornes ou en double.',
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Règles de Nikias' }));
    expect(api.stewardCommand).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Stock visé (unités)'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Monter la règle 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les règles' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.stewardCommand).toHaveBeenCalledWith(
      'steward.setRules',
      {
        stewardId: 'st1',
        rules: [
          { kind: 'buy', goodId: 'wheat', maxPriceOboles: 7, targetUnits: 50 },
          { kind: 'sell', goodId: 'flour', minPriceOboles: 14, keepUnits: 20 },
        ],
      },
      't',
      expect.any(String),
    );
    expect(screen.getByRole('status').textContent).toBe('Nikias suivra 2 règles.');
  });

  it('un refus est dit ; une commande sans réponse repart sous la même clé', async () => {
    api.stewardCommand
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: 'x' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'STEWARD_NOT_FOUND', message: 'x' } });
    await show({ ...nikias, state: 'unpaid', since: new Date('2026-11-18T03:00:00Z') });
    expect(screen.getByText(/^Salaire de Nikias impayé depuis le/)).toBeTruthy();
    const dismiss = screen.getByRole('button', { name: 'Renvoyer Nikias' });
    fireEvent.click(dismiss);
    const alerts = () => screen.getAllByRole('alert').map((node) => node.textContent);
    await waitFor(() => expect(alerts()).toContain(fr.errors.INTERNAL));
    fireEvent.click(dismiss);
    await waitFor(() => expect(api.stewardCommand).toHaveBeenCalledTimes(2));
    const [first, second] = api.stewardCommand.mock.calls;
    expect(first?.[3]).toBe(second?.[3]);
    expect(first?.slice(0, 2)).toEqual(['steward.dismiss', { stewardId: 'st1' }]);
    await waitFor(() => expect(alerts()).toContain("Cet intendant n'est plus en poste."));
  });

  it('une intention sans réponse cesse quand la relecture en montre l’effet : une réembauche prend une clé neuve', async () => {
    const lost = { ok: false, error: { code: 'INTERNAL', message: 'x' } };
    api.stewardCommand.mockResolvedValue(lost);
    const keyOf = (call: number) => api.stewardCommand.mock.calls[call]?.[3] as string;
    const click = async (name: string, calls: number) => {
      fireEvent.click(screen.getByRole('button', { name }));
      await waitFor(() => expect(api.stewardCommand).toHaveBeenCalledTimes(calls));
      cleanup();
    };
    await show(undefined);
    await click('Embaucher un intendant pour Moulin', 1);
    // Relue, l'embauche a eu lieu ; renvoyé ensuite, le site réembauche sous une autre clé.
    await show(nikias);
    await click('Enregistrer les règles', 2);
    await show(undefined);
    await click('Embaucher un intendant pour Moulin', 3);
    expect(keyOf(2)).not.toBe(keyOf(0));
    // Les règles relues à une révision plus récente : les mêmes règles repartent sous une clé neuve.
    await show({ ...nikias, revision: 2 });
    await click('Enregistrer les règles', 4);
    expect(keyOf(3)).not.toBe(keyOf(1));
  });
});
