// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import type { Steward, StewardInstruction } from '../stewards';

// Consigne en langage naturel sur la fiche d'un site (#280) : commandes espionnées, aucune lecture.
const api = vi.hoisted(() => ({ stewardCommand: vi.fn() }));
vi.mock('../api', () => ({ stewardCommand: api.stewardCommand }));
const { SiteSteward } = await import('./SiteSteward');

const mill = (INITIAL_CONFIG as GameConfig).recipes.find((recipe) => recipe.id === 'mill_flour');
const nikias: Steward = {
  id: 'st1',
  siteId: 's1',
  name: 'Nikias',
  state: 'active',
  since: null,
  revision: 1,
  rules: [],
};
const sell = { kind: 'sell', goodId: 'flour', minPriceOboles: 18, keepUnits: 20 } as const;
const buy = { kind: 'buy', goodId: 'wheat', maxPriceOboles: 7, targetUnits: 50 } as const;
const proposal: StewardInstruction = {
  stewardId: 'st1',
  revision: 1,
  text: 'vends la farine à 3 drachmes en gardant 20 sacs, rachète le blé à 7 oboles jusqu’à 50',
  status: 'answered',
  rules: [sell, buy],
  simulation: [
    { position: 0, status: 'idle' },
    {
      position: 1,
      status: 'rejected',
      code: 'INSUFFICIENT_FUNDS',
      summary: {
        command: 'market.placeOrder',
        side: 'buy',
        goodId: 'wheat',
        price: 7,
        quantity: 50,
      },
    },
  ],
  refusal: null,
};
const onChanged = vi.fn(() => Promise.resolve());
async function show(instruction?: StewardInstruction) {
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
          steward={nikias}
          instruction={instruction}
          rules={{ limit: 2, dailyWageOboles: 8, rulesPerSteward: 3, refusalRestTicks: 0 }}
          posted={1}
          onChanged={onChanged}
        />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const rulesForm = () => screen.getByRole('form', { name: 'Règles de Nikias' });
const write = (text: string) => {
  fireEvent.change(screen.getByLabelText('Votre consigne à Nikias, en vos mots'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Traduire en règles' }));
};
beforeEach(() => {
  api.stewardCommand.mockReset();
  onChanged.mockClear();
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('consigne d’un intendant (#280)', () => {
  it('envoie la consigne, sans espaces autour, et dit qu’elle est à l’étude', async () => {
    api.stewardCommand.mockResolvedValue({ ok: true, replayed: false, data: {} });
    await show();
    write('  vends la farine à 3 drachmes \n');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.stewardCommand).toHaveBeenCalledWith(
      'steward.submitInstruction',
      { stewardId: 'st1', text: 'vends la farine à 3 drachmes' },
      't',
      expect.any(String),
    );
    expect(screen.getByRole('status').textContent).toMatch(/^Nikias étudie votre consigne/);
  });

  it('IA coupée : l’écran le dit et mène au formulaire, qui reste entier', async () => {
    api.stewardCommand.mockResolvedValue({
      ok: false,
      error: { code: 'AI_UNAVAILABLE', message: 'x' },
    });
    await show();
    write('vends la farine');
    await waitFor(() => expect(document.activeElement).toBe(rulesForm()));
    expect(screen.getByText(/consignes en langage naturel sont indisponibles/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enregistrer les règles' })).toBeTruthy();
  });

  it('une proposition : ses règles et leur simulation ; « Valider » donne ces règles à l’intendant', async () => {
    api.stewardCommand.mockResolvedValue({ ok: true, replayed: false, data: {} });
    await show(proposal);
    expect(screen.getByText(/^Votre consigne : « vends la farine/)).toBeTruthy();
    const lines = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(lines).toEqual([
      "1. Vendre Farine à 3 drachmes l'unité ou plus, en gardant 20 unités — maintenant : rien à faire",
      "2. Racheter Blé à 1 drachme 1 obole l'unité ou moins, jusqu'à 50 unités en stock — maintenant : rachat de Blé refusé : Trésorerie insuffisante.",
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.stewardCommand).toHaveBeenCalledWith(
      'steward.setRules',
      { stewardId: 'st1', rules: [sell, buy] },
      't',
      expect.any(String),
    );
  });

  it('« Modifier » met les règles proposées dans le formulaire, sans rien envoyer', async () => {
    await show(proposal);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    expect(document.activeElement).toBe(rulesForm());
    expect(
      (screen.getByLabelText("Prix plancher (oboles l'unité)") as HTMLInputElement).value,
    ).toBe('18');
    expect((screen.getByLabelText('Stock visé (unités)') as HTMLInputElement).value).toBe('50');
    expect(api.stewardCommand).not.toHaveBeenCalled();
  });

  it('un refus motivé le dit et mène au formulaire ; une consigne en attente se relit', async () => {
    await show({ ...proposal, rules: null, simulation: null, refusal: 'AI_UNAVAILABLE' });
    expect(screen.getByText(/^L'IA est coupée pour l'instant : Nikias ne peut pas/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aller au formulaire des règles' }));
    expect(document.activeElement).toBe(rulesForm());
    cleanup();
    await show({ ...proposal, status: 'pending', rules: null, simulation: null });
    expect(
      screen.getByText('Nikias étudie cette consigne ; sa proposition arrive sous peu.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Votre consigne à Nikias, en vos mots')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('une proposition d’une révision passée n’est plus offerte', async () => {
    await show({ ...proposal, revision: 0 });
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull();
    expect(screen.queryByText(/^Votre consigne : /)).toBeNull();
    expect(screen.getByLabelText('Votre consigne à Nikias, en vos mots')).toBeTruthy();
  });
});
