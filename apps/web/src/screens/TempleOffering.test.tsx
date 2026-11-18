// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import { parseTempleRules } from '../temple';

// Offrande du temple (#272) : stock simulé, commande espionnée.
const state = vi.hoisted(() => ({ stock: [] as unknown[], favor: new Map<string, number>() }));
const api = vi.hoisted(() => ({ makeOffering: vi.fn() }));
vi.mock('../api', () => ({ makeOffering: api.makeOffering }));
vi.mock('../data', () => ({
  useRows: () => ({ rows: state.stock, failed: false, reload: () => Promise.resolve([]) }),
}));
const { TempleOffering } = await import('./TempleOffering');

const rules = parseTempleRules({
  gods: [
    { id: 'demeter', charisPerObole: 1, charisPerUnit: { wheat: 5, bread: 30 } },
    { id: 'poseidon', charisPerUnit: { fish: 10 } },
    { id: 'old' },
  ],
});
const onDone = vi.fn(() => Promise.resolve());
async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  if (!rules) throw new Error('règles attendues');
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        <TempleOffering rules={rules} favor={state.favor} onDone={onDone} />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const done = (data: object) => ({
  ok: true,
  replayed: false,
  data: { offeringId: 'o1', godId: 'demeter', oboles: 12, goods: [], ...data },
});
beforeEach(() => {
  api.makeOffering.mockReset();
  onDone.mockClear();
  state.stock = [
    { good_id: 'wheat', quantity: 80, reserved: 30 },
    { good_id: 'bread', quantity: 4, reserved: 4 },
    { good_id: 'fish', quantity: 9, reserved: 0 },
  ];
  state.favor = new Map([['demeter', 100]]);
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('offrande au temple (#272)', () => {
  it('monnaie et biens du stock libre acceptés, Charis annoncée avant l’envoi et envoyée telle quelle', async () => {
    api.makeOffering.mockResolvedValue(done({ charisGained: 112, charis: 1112 }));
    await show();
    // Le dieu sans taux n'est pas proposé ; le pain, tout réservé, ni le poisson, refusé par Déméter, non plus.
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Déméter',
      'Poséidon',
    ]);
    expect(screen.queryByLabelText(/^Pain/)).toBeNull();
    expect(screen.queryByLabelText(/^Poisson/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Oboles offertes (1 Charis par obole)'), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText("Blé (50 libres, 5 Charis l'unité)"), {
      target: { value: '20' },
    });
    expect(
      screen.getByText('Cette offrande vous rapportera 112 Charis envers Déméter.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Offrir à Déméter (+112 Charis)' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.makeOffering.mock.calls[0]?.slice(0, 2)).toEqual([
      {
        godId: 'demeter',
        oboles: 12,
        goods: [{ goodId: 'wheat', quantity: 20 }],
        expectedCharis: 112,
      },
      't',
    ]);
    // Le contrôle est inactif une fois la saisie remise à zéro : le foyer va au résultat.
    const status = screen.getByText(/^Offrande faite à Déméter : \+112 Charis/);
    await waitFor(() => expect(document.activeElement).toBe(status));
    const reset = screen.getByRole('button', { name: 'Offrir à Déméter (+0 Charis)' });
    expect(reset).toHaveProperty('disabled', true);
  });

  it('un dieu qui refuse la monnaie n’a pas de saisie d’oboles ; une saisie fautive est dite et n’envoie rien', async () => {
    await show();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'poseidon' } });
    expect(screen.queryByLabelText(/^Oboles offertes/)).toBeNull();
    const fish = screen.getByLabelText("Poisson (9 libres, 10 Charis l'unité)");
    fireEvent.change(fish, { target: { value: '10' } });
    expect(screen.getByRole('alert').textContent).toBe(fr.temple.offering.overStock);
    fireEvent.change(fish, { target: { value: '2,5' } });
    expect(screen.getByRole('alert').textContent).toBe(fr.temple.offering.unreadable);
    const submit = screen.getByRole('button', { name: /^Offrir à Poséidon/ });
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.click(submit);
    expect(api.makeOffering).not.toHaveBeenCalled();
  });

  it('sans réponse, la même offrande repart sous la même clé ; rendue dès que la Charis relue a changé', async () => {
    api.makeOffering.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: '' } });
    await show();
    const send = async (calls: number) => {
      fireEvent.change(screen.getByLabelText(/^Oboles offertes/), { target: { value: '12' } });
      fireEvent.click(screen.getByRole('button', { name: /^Offrir à Déméter/ }));
      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(calls));
    };
    await send(1);
    expect(screen.getByText(fr.errors.INTERNAL)).toBeTruthy();
    await send(2);
    expect(window.sessionStorage.length).toBe(1);
    cleanup();
    // La première avait abouti : la Charis relue a monté, la même saisie est une demande neuve.
    state.favor = new Map([['demeter', 112]]);
    api.makeOffering.mockResolvedValue({
      ok: false,
      error: { code: 'CHARIS_CHANGED', message: '' },
    });
    await show();
    expect(window.sessionStorage.length).toBe(0);
    await send(3);
    expect(screen.getByText(fr.errors.CHARIS_CHANGED)).toBeTruthy();
    const [first, second, third] = api.makeOffering.mock.calls.map((call) => call[2] as string);
    expect(second).toBe(first);
    expect(third).not.toBe(second);
  });

  it('au-delà de la borne des oboles du contrat, la saisie est refusée avant l’envoi', async () => {
    await show();
    fireEvent.change(screen.getByLabelText(/^Oboles offertes/), {
      target: { value: '1000000001' },
    });
    expect(screen.getByRole('alert').textContent).toMatch(
      /^Au plus 1\s000\s000\s000 oboles par offrande\.$/,
    );
    const submit = screen.getByRole('button', { name: /^Offrir à Déméter/ });
    expect(submit).toHaveProperty('disabled', true);
  });
});
