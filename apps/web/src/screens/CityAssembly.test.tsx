// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CITED_HOUSE_READS } from '../cited-houses';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Assemblée de l'onglet Cité (#264) : lectures simulées vue par vue, commandes espionnées.
// La vue `houses` rend au plus 1 000 lignes par lecture, par ordre de nom, comme PostgREST (`max_rows`).
const state = vi.hoisted(() => ({
  views: {} as Record<string, unknown[] | null>,
  houseFilters: [] as unknown[],
}));
const api = vi.hoisted(() => ({ cityCommand: vi.fn() }));
vi.mock('../api', () => ({ cityCommand: api.cityCommand }));
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, _order: string, filters: unknown = {}) => {
    if (view === 'houses') state.houseFilters.push(filters);
    if (view === 'houses' && filters === null)
      return { rows: null, failed: false, reload: () => Promise.resolve(null) };
    let rows = view in state.views ? (state.views[view] ?? null) : [];
    const ids = (filters as { id?: string[] }).id;
    if (view === 'houses' && rows)
      rows = (rows as { id: string; name: string }[])
        .filter((row) => !ids || ids.includes(row.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 1000);
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
// Filtres des lectures de maisons du dernier rendu : un nombre fixe de lectures, les vides à `null`.
const houseReads = () => state.houseFilters.slice(-CITED_HOUSE_READS).filter(Boolean);
const { CityAssembly } = await import('./CityAssembly');

const decree = (id: string, status: string, model: string, params: unknown, extra = {}) => ({
  id,
  city_id: 'c1',
  model,
  params,
  proposed_by: 'h2',
  status,
  proposed_at: '2026-11-15T10:00:00+00:00',
  voting_closes_at: '2026-11-17T10:00:00+00:00',
  quorum_bps: 2000,
  tallied_at: status === 'proposed' ? null : '2026-11-17T04:00:00+00:00',
  electorate: status === 'proposed' ? null : 5,
  votes_for: status === 'proposed' ? null : 3,
  votes_against: status === 'proposed' ? null : 1,
  applied_at: null,
  ...extra,
});
const houses = [
  { id: 'h1', name: 'Maison Test', citizenship_status: 'citizen' },
  { id: 'h2', name: 'Maison Alpha', citizenship_status: 'citizen' },
];
async function show() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'metic' }}
      >
        <CityAssembly />
      </HouseProvider>
    </I18nextProvider>,
  );
}
beforeEach(() => {
  api.cityCommand.mockReset();
  api.cityCommand.mockResolvedValue({ ok: true, data: {}, replayed: false });
});
afterEach(() => {
  cleanup();
  state.views = {};
  state.houseFilters = [];
});

describe('assemblée de la cité (#264)', () => {
  it('décret au vote : pour ou contre en deux touches, le résultat reçoit le foyer ; voté, rien ne dit le choix', async () => {
    state.views = {
      houses,
      decrees: [decree('d1', 'proposed', 'market_tax_rate', { rateBps: 800 })],
    };
    await show();
    expect(screen.getByText(/^Taxe de marché de la cité à 8\s?%$/)).toBeTruthy();
    expect(screen.getByText(/^Proposé par Maison Alpha ; vote clos le /)).toBeTruthy();
    const against = screen.getByRole('button', { name: /^Voter contre : Taxe de marché/ });
    fireEvent.click(against);
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.slice(0, 3)).toEqual([
      'city.voteDecree',
      { decreeId: 'd1', approve: false },
      't',
    ]);
    await waitFor(() => expect(document.activeElement?.textContent).toBe(fr.assembly.voted));
    cleanup();
    state.views.my_decree_votes = [{ decree_id: 'd1' }];
    await show();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(fr.assembly.alreadyVoted)).toBeTruthy();
  });

  it('adoptés et en vigueur, rejetés et caducs, avec leur décompte ; décret illisible nommé par son modèle', async () => {
    state.views = {
      houses,
      decrees: [
        decree(
          'd2',
          'applied',
          'port_dues',
          { coefficientBps: 15000 },
          { applied_at: '2026-11-17T04:00:00+00:00' },
        ),
        // Appliqué plus tôt, remplacé par d2 : appliqué, plus en vigueur.
        decree(
          'd1',
          'applied',
          'port_dues',
          { coefficientBps: 12000 },
          { applied_at: '2026-11-10T04:00:00+00:00' },
        ),
        decree('d3', 'adopted', 'festival', {
          amountOboles: 600,
          days: 2,
          goodIds: ['bread', 'wine'],
        }),
        decree('d4', 'lapsed', 'public_works', { amountOboles: 6000 }),
        decree('d5', 'rejected', 'market_tax_rate', { rateBps: 'huit' }),
      ],
    };
    await show();
    expect(screen.getByText('Droit de port de la cité multiplié par 1,5')).toBeTruthy();
    const applied = screen.getAllByText(/^Appliqué le /).map((line) => line.textContent ?? '');
    expect(applied).toHaveLength(2);
    expect(applied.filter((line) => line.endsWith('; en vigueur'))).toHaveLength(1);
    expect(
      screen.getByText('Droit de port de la cité multiplié par 1,2').parentElement?.textContent,
    ).not.toContain('en vigueur');
    expect(screen.getByText('Fête de 2 jours : 100 drachmes, pour Pain, Vin')).toBeTruthy();
    expect(screen.getByText(fr.assembly.status.adopted)).toBeTruthy();
    expect(screen.getByText(/^Grands travaux : 1\s?000 drachmes$/)).toBeTruthy();
    expect(screen.getByText(fr.assembly.status.lapsed)).toBeTruthy();
    expect(screen.getByText('Décret illisible (market_tax_rate)')).toBeTruthy();
    expect(screen.getAllByText('Pour : 3 ; contre : 1 ; citoyens : 5')).toHaveLength(5);
    expect(screen.getByText(fr.assembly.noOpen)).toBeTruthy();
  });

  it('un métèque voit les décrets au vote sans bouton, et l’écran dit pourquoi ; un refus est dit', async () => {
    state.views = {
      houses: [{ ...houses[0], citizenship_status: 'metic' }, houses[1]],
      decrees: [decree('d1', 'proposed', 'public_works', { amountOboles: 600 })],
    };
    await show();
    expect(screen.getByText(fr.assembly.meticNotice)).toBeTruthy();
    expect(screen.getByText('Grands travaux : 100 drachmes')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    cleanup();
    api.cityCommand.mockResolvedValue({ ok: false, error: { code: 'VOTING_CLOSED', message: '' } });
    state.views.houses = houses;
    await show();
    fireEvent.click(screen.getByRole('button', { name: /^Voter pour : Grands travaux/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(fr.errors.VOTING_CLOSED);
  });
  it('aucun décret adopté ; lectures en échec annoncées, celle des votes de la maison comprise', async () => {
    state.views = { houses, decrees: [] };
    await show();
    expect(screen.getByText(fr.assembly.noPassed)).toBeTruthy();
    cleanup();
    state.views = { houses, decrees: null };
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
    cleanup();
    state.views = {
      houses,
      decrees: [decree('d1', 'proposed', 'public_works', { amountOboles: 600 })],
      my_decree_votes: null,
    };
    await show();
    expect(screen.queryByRole('button', { name: /^Voter pour/ })).toBeNull();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });

  it('sans réponse, le vote repart sous la même clé ; après un refus, la clé suivante est neuve', async () => {
    api.cityCommand.mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: '' } });
    api.cityCommand.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VOTING_CLOSED', message: '' },
    });
    state.views = {
      houses,
      decrees: [decree('d1', 'proposed', 'public_works', { amountOboles: 600 })],
    };
    await show();
    const approve = () => screen.getByRole('button', { name: /^Voter pour : Grands travaux/ });
    for (let call = 1; call <= 3; call++) {
      await waitFor(() => expect(approve().getAttribute('aria-disabled')).toBe('false'));
      fireEvent.click(approve());
      await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(call));
    }
    const keys = api.cityCommand.mock.calls.map((call) => call[3] as string);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('auteur au-delà de la millième maison : seuls les auteurs des décrets au vote sont lus (#441)', async () => {
    const crowd = Array.from({ length: 1_200 }, (_, i) => ({
      id: `x${String(i)}`,
      name: `Maison A${String(i).padStart(4, '0')}`,
      citizenship_status: 'citizen',
    }));
    state.views = {
      houses: [
        ...crowd,
        { id: 'h1', name: 'Maison Zénon', citizenship_status: 'citizen' },
        { id: 'h2', name: 'Maison Zeus', citizenship_status: 'citizen' },
      ],
      decrees: [
        decree('d1', 'proposed', 'public_works', { amountOboles: 600 }),
        decree('d2', 'rejected', 'public_works', { amountOboles: 600 }, { proposed_by: 'x5' }),
      ],
    };
    // La coquille croit la maison métèque ; sa propre ligne, relue, la dit citoyenne.
    await show();
    expect(houseReads()).toEqual([{ id: ['h1', 'h2'] }]);
    expect(screen.getByText(/^Proposé par Maison Zeus ; vote clos le /)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Voter pour : Grands travaux/ })).toBeTruthy();
    expect(screen.queryByText(fr.assembly.meticNotice)).toBeNull();
  });

  it('un décret par carte : ses boutons de vote dans sa carte, son décompte doublé d’une barre (#697)', async () => {
    state.views = {
      houses,
      decrees: [
        decree('d1', 'proposed', 'public_works', { amountOboles: 600 }),
        decree('d2', 'rejected', 'public_works', { amountOboles: 1200 }),
      ],
    };
    await show();
    const open = screen.getByRole('button', { name: /^Voter pour : Grands travaux/ }).closest('li');
    expect(open?.textContent).toMatch(/^Grands travaux : 100 drachmesProposé par Maison Alpha/);
    const rejected = screen.getByText(fr.assembly.status.rejected).closest('li');
    expect(rejected?.querySelector('[aria-hidden="true"] > span')?.getAttribute('style')).toBe(
      'width: 60%;',
    );
    expect(rejected?.textContent).toContain('Pour : 3 ; contre : 1 ; citoyens : 5');
  });
});
