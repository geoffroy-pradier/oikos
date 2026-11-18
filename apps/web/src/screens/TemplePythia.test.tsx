// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { parseTempleRules } from '../temple';

// La Pythie (#272) : oracles simulés, commande espionnée.
const state = vi.hoisted(() => ({
  oracles: [] as unknown[] | null,
  latest: undefined as unknown,
  favor: new Map<string, number>(),
}));
const api = vi.hoisted(() => ({ consultOracle: vi.fn() }));
vi.mock('../api', () => ({ consultOracle: api.consultOracle }));
vi.mock('../data', () => ({
  useRows: (
    _view: string,
    _columns: string,
    _order: string,
    _filters: unknown,
    latest: unknown,
  ) => {
    state.latest = latest;
    return {
      rows: state.oracles,
      failed: state.oracles === null,
      reload: () => Promise.resolve(state.oracles),
    };
  },
}));
const { TemplePythia } = await import('./TemplePythia');

const apollo = { id: 'apollo', charisPerObole: 2 };
const onDone = vi.fn(() => Promise.resolve());
async function show(oracle: unknown = { godId: 'apollo', consultationOboles: 60 }, lng = 'fr') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  const rules = parseTempleRules({ gods: [apollo], oracle });
  if (!rules) throw new Error('règles attendues');
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        <TemplePythia rules={rules} favor={state.favor} onDone={onDone} />
      </HouseProvider>
    </I18nextProvider>,
  );
}
const oracle = (id: string, text: string, source = 'fallback') => ({
  id,
  house_id: 'h1',
  text_fr: text,
  text_en: `EN ${text}`,
  source,
  consulted_at: '2026-11-17T12:00:00+00:00',
});
beforeEach(() => {
  api.consultOracle.mockReset();
  onDone.mockClear();
  state.oracles = [];
  state.favor = new Map([['apollo', 40]]);
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('la Pythie (#272)', () => {
  it('prix et Charis annoncés, consultation au prix vu ; une Pythie muette est payée et le dit', async () => {
    api.consultOracle.mockResolvedValue({
      ok: true,
      replayed: false,
      data: { oboles: 60, charisGained: 120, charis: 120, oracles: [] },
    });
    await show();
    expect(
      screen.getByText(
        'Une consultation coûte 10 drachmes et vous rapporte 120 Charis envers Apollon.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Consulter la Pythie pour 10 drachmes' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.consultOracle.mock.calls[0]?.slice(0, 2)).toEqual([60, 't']);
    expect(screen.getByRole('status').textContent).toBe(
      'Consultation faite pour 10 drachmes : +120 Charis. La Pythie se tait : aucun événement ne s’annonce pour l’instant.'.replace(
        /’/g,
        "'",
      ),
    );
    expect(state.latest).toEqual({ limit: 20 });
  });

  it('oracles consultés en texte brut, date de l’événement imprécise, mention de l’IA selon la source', async () => {
    state.oracles = [
      oracle('o1', 'Le ciel <b>se ferme</b> <img src=x onerror="alert(1)">', 'ai'),
      oracle('o2', 'Les épis se courbent.'),
    ];
    const { container } = await show();
    expect(screen.getByText('Le ciel <b>se ferme</b> <img src=x onerror="alert(1)">')).toBeTruthy();
    expect(container.querySelector('img, b')).toBeNull();
    expect(screen.getAllByText(/Date de l'événement : imprécise/)).toHaveLength(2);
    expect(screen.getAllByText(new RegExp(fr.temple.pythia.aiNote))).toHaveLength(1);
    cleanup();
    await show(undefined, 'en');
    expect(screen.getByText('EN Les épis se courbent.')).toBeTruthy();
  });

  it('version sans Pythie : rien à consulter ; prix changé ou lecture en échec annoncés', async () => {
    await show(null);
    expect(screen.getByText(fr.temple.pythia.unavailable)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    api.consultOracle.mockResolvedValue({
      ok: false,
      error: { code: 'PRICE_CHANGED', message: '' },
    });
    state.oracles = null;
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Consulter la Pythie/ }));
    await waitFor(() => expect(screen.getByText(fr.errors.PRICE_CHANGED)).toBeTruthy());
  });

  it('sans réponse, la clé est gardée au même prix ; rendue dès que la Charis relue envers Apollon a changé', async () => {
    api.consultOracle.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: '' } });
    await show();
    const consult = async (calls: number) => {
      fireEvent.click(screen.getByRole('button', { name: /^Consulter la Pythie/ }));
      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(calls));
    };
    await consult(1);
    await consult(2);
    expect(window.sessionStorage.length).toBe(1);
    // Un autre prix en vigueur : une demande neuve, jamais la même clé avec un autre prix.
    cleanup();
    await show({ godId: 'apollo', consultationOboles: 66 });
    await consult(3);
    cleanup();
    // La consultation avait abouti : la Charis relue a monté, la clé est rendue.
    state.favor = new Map([['apollo', 172]]);
    await show();
    expect(window.sessionStorage.length).toBe(0);
    await consult(4);
    const calls = api.consultOracle.mock.calls.map((call) => [call[0], call[2]]);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]?.[0]).toBe(66);
    expect(calls[2]?.[1]).not.toBe(calls[1]?.[1]);
    expect(calls[3]?.[1]).not.toBe(calls[2]?.[1]);
  });
});
