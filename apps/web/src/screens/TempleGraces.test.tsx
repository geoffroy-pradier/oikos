// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import { parseTempleRules } from '../temple';

// Grâces du temple (#272) : invocations simulées, commande espionnée, heure du serveur fixée.
const state = vi.hoisted(() => ({ uses: [] as unknown[] | null }));
const api = vi.hoisted(() => ({ invokeGrace: vi.fn() }));
vi.mock('../api', () => ({ invokeGrace: api.invokeGrace }));
vi.mock('../data', () => ({
  useRows: () => ({
    rows: state.uses,
    failed: state.uses === null,
    reload: () => Promise.resolve(state.uses),
  }),
}));
vi.mock('../server-clock', () => ({
  serverClock: { now: () => new Date('2026-11-18T12:00:00Z') },
}));
const { TempleGraces } = await import('./TempleGraces');

const graces = ['blessed_harvest', 'fair_wind', 'inspired_workshop'].map((effect, index) => ({
  id: effect,
  godId: ['demeter', 'poseidon', 'athena'][index],
  effect,
  magnitudeBps: 2_500,
  charisRequired: 200,
  charisSpent: 150,
  cooldownDays: 1 + index,
}));
const onDone = vi.fn(() => Promise.resolve());
async function show(favor: Record<string, number>, offered: unknown[] = graces) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  const rules = parseTempleRules({ graces: offered });
  if (!rules) throw new Error('règles attendues');
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        <TempleGraces rules={rules} favor={new Map(Object.entries(favor))} onDone={onDone} />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const invoked = {
  ok: true,
  replayed: false,
  data: { readyAt: '2026-11-19T12:00:00Z', charis: 60 },
};
beforeEach(() => {
  api.invokeGrace.mockReset();
  onDone.mockClear();
  state.uses = [];
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('grâces du temple (#272)', () => {
  it('à invoquer d’une touche, en recharge jusqu’à une date, en attente, ou Charis insuffisante', async () => {
    state.uses = [
      {
        id: 'u1',
        house_id: 'h1',
        grace_id: 'fair_wind',
        god_id: 'poseidon',
        effect: 'fair_wind',
        magnitude_bps: 2_500,
        charis_spent: 150,
        invoked_at: '2026-11-17T08:00:00+00:00',
        ready_at: '2026-11-20T12:00:00+00:00',
        consumed_at: null,
      },
    ];
    api.invokeGrace.mockResolvedValue(invoked);
    await show({ demeter: 210, poseidon: 500, athena: 20 });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Récolte bénie (Déméter)',
      'Vent favorable (Poséidon)',
      'Atelier inspiré (Athéna)',
    ]);
    expect(
      screen.getByText(
        /^La prochaine récolte d'un site de matière première rend 25\s?% de plus\.$/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/^En attente : .* se recharge jusqu'au 20 nov\. 2026/)).toBeTruthy();
    expect(screen.getByText('Charis insuffisante : il vous en manque 180.')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    // Une touche : le bouton, qui nomme la Charis dépensée.
    fireEvent.click(
      screen.getByRole('button', { name: 'Invoquer Récolte bénie (Déméter) (−150 Charis)' }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.invokeGrace.mock.calls[0]?.slice(0, 3)).toEqual(['blessed_harvest', 150, 't']);
    expect(screen.getByRole('status').textContent).toMatch(
      /^Grâce invoquée : Récolte bénie \(Déméter\)\. .* jusqu'au 19 nov\. 2026.* Charis envers ce dieu : 60\.$/,
    );
  });

  it('sans réponse, l’invocation repart sous la même clé ; rendue dès que la grâce se lit en recharge', async () => {
    api.invokeGrace.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: '' } });
    await show({ demeter: 210 });
    const button = () => screen.getByRole('button', { name: /^Invoquer Récolte bénie/ });
    fireEvent.click(button());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert').textContent).toBe(fr.errors.INTERNAL);
    fireEvent.click(button());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));
    const [first, second] = api.invokeGrace.mock.calls.map((call) => call[3] as string);
    expect(second).toBe(first);
    // Une autre Charis dépensée en vigueur : une demande neuve, jamais la même clé avec une autre entrée.
    cleanup();
    graces[0] = { ...graces[0], charisSpent: 160 } as (typeof graces)[number];
    await show({ demeter: 210 });
    fireEvent.click(button());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(3));
    graces[0] = { ...graces[0], charisSpent: 150 } as (typeof graces)[number];
    expect(api.invokeGrace.mock.calls[2]?.[1]).toBe(160);
    expect(api.invokeGrace.mock.calls[2]?.[3]).not.toBe(first);
    expect(window.sessionStorage.length).toBe(1);
    cleanup();
    state.uses = [
      {
        id: 'u2',
        house_id: 'h1',
        grace_id: 'blessed_harvest',
        god_id: 'demeter',
        effect: 'blessed_harvest',
        magnitude_bps: 2_500,
        charis_spent: 150,
        invoked_at: '2026-11-18T08:00:00+00:00',
        ready_at: '2026-11-19T12:00:00+00:00',
        consumed_at: '2026-11-18T09:00:00+00:00',
      },
    ];
    await show({ demeter: 210 });
    expect(screen.getByText(/^En recharge jusqu'au 19 nov\. 2026/)).toBeTruthy();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('aucune grâce offerte ; une lecture en échec est annoncée', async () => {
    await show({}, []);
    expect(screen.getByText(fr.temple.graces.none)).toBeTruthy();
    cleanup();
    state.uses = null;
    await show({});
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });
});
