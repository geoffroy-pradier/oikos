// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Candidature et vote à l'élection de l'archonte (#264) : lectures simulées, commandes espionnées.
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
const api = vi.hoisted(() => ({ cityCommand: vi.fn() }));
vi.mock('../api', () => ({ cityCommand: api.cityCommand }));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
vi.mock('./HouseLink', () => import('./house-link-mock'));
const { CityPolitics } = await import('./CityPolitics');

const day = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();
const election = (phase: 'filing' | 'voting') => ({
  id: 'e1',
  city_id: 'c1',
  office: 'archon',
  candidacy_opens_at: iso(phase === 'filing' ? -1 : -5),
  voting_opens_at: iso(phase === 'filing' ? 2 : -1),
  voting_closes_at: iso(phase === 'filing' ? 5 : 2),
  term_ends_at: iso(30),
  tallied_at: null,
});
const houses = [
  { id: 'h1', name: 'Maison Test', citizenship_status: 'citizen' },
  { id: 'h2', name: 'Maison Alpha', citizenship_status: 'citizen' },
];
const candidates = [
  { id: 'k1', election_id: 'e1', house_id: 'h1', withdrawn_at: null },
  { id: 'k2', election_id: 'e1', house_id: 'h2', withdrawn_at: null },
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
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'citizen' }}
      >
        <CityPolitics />
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
});

describe('candidature et vote à l’élection (#264)', () => {
  it('dépôt : se porter candidate, le résultat reçoit le foyer ; candidate, elle peut se retirer', async () => {
    state.views = { houses, elections: [election('filing')] };
    await show();
    fireEvent.click(screen.getByRole('button', { name: fr.cityPolitics.stand }));
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.slice(0, 3)).toEqual([
      'city.standForElection',
      { electionId: 'e1' },
      't',
    ]);
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe(fr.cityPolitics.done.standForElection),
    );
    expect(document.activeElement?.getAttribute('role')).toBe('status');
    cleanup();
    state.views.election_candidates = candidates;
    await show();
    fireEvent.click(screen.getByRole('button', { name: fr.cityPolitics.withdraw }));
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(2));
    expect(api.cityCommand.mock.calls[1]?.[0]).toBe('city.withdrawCandidacy');
  });

  it('vote : un bouton par candidature ; voté, la maison sait seulement qu’elle a voté', async () => {
    state.views = { houses, elections: [election('voting')], election_candidates: candidates };
    await show();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Voter pour Maison Alpha' }));
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.slice(0, 2)).toEqual([
      'city.castVote',
      { electionId: 'e1', candidacyId: 'k2' },
    ]);
    cleanup();
    state.views.my_ballots = [{ election_id: 'e1' }];
    await show();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(fr.cityPolitics.voted)).toBeTruthy();
  });

  it('sans réponse, le nouvel essai rejoue la même clé ; un refus est dit, la clé suivante est neuve', async () => {
    api.cityCommand.mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: '' } });
    api.cityCommand.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TERM_LIMIT_REACHED', message: '' },
    });
    state.views = { houses, elections: [election('filing')] };
    await show();
    const stand = () => screen.getByRole('button', { name: fr.cityPolitics.stand });
    fireEvent.click(stand());
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stand().getAttribute('aria-disabled')).toBe('false'));
    fireEvent.click(stand());
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await waitFor(() => expect(stand().getAttribute('aria-disabled')).toBe('false'));
    fireEvent.click(stand());
    await waitFor(() => expect(api.cityCommand).toHaveBeenCalledTimes(3));
    const keys = api.cityCommand.mock.calls.map((call) => call[3] as string);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('un métèque n’a aucun bouton, même pendant le vote', async () => {
    state.views = {
      houses: [{ ...houses[0], citizenship_status: 'metic' }, houses[1]],
      elections: [election('voting')],
      election_candidates: candidates,
    };
    await show();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
  it('retrait définitif : averti avant, puis plus de candidature possible ; lecture des votes en échec annoncée', async () => {
    state.views = {
      houses,
      elections: [election('filing')],
      election_candidates: [candidates[0]],
    };
    await show();
    const withdraw = screen.getByRole('button', { name: fr.cityPolitics.withdraw });
    expect(withdraw.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(fr.cityPolitics.withdrawWarning)).toBeTruthy();
    cleanup();
    state.views.election_candidates = [{ ...candidates[0], withdrawn_at: '2026-11-15T00:00:00Z' }];
    await show();
    expect(screen.queryByRole('button', { name: fr.cityPolitics.stand })).toBeNull();
    expect(screen.getByText(fr.cityPolitics.withdrawn)).toBeTruthy();
    cleanup();
    state.views = {
      houses,
      elections: [election('voting')],
      election_candidates: candidates,
      my_ballots: null,
    };
    await show();
    expect(screen.queryByRole('button', { name: /^Voter pour/ })).toBeNull();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });
});
