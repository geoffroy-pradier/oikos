// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Onglet Cité avec le vrai `useRows` (#441) : client Supabase simulé qui compte les lectures de chaque vue
// et retient les identifiants demandés à la vue `houses`, heure du serveur qui avance à chaque appel.
const calls = vi.hoisted(() => ({ reads: new Map<string, number>(), houseIds: [] as unknown[] }));
const at = (days: number) => new Date(Date.parse('2026-11-17T12:00:00Z') + days * 86_400_000);
const data: Record<string, unknown[]> = {
  houses: [
    { id: 'h1', name: 'Maison Test', citizenship_status: 'citizen' },
    { id: 'h2', name: 'Maison Zeus', citizenship_status: 'citizen' },
    { id: 'h3', name: 'Maison Zoé', citizenship_status: 'citizen' },
  ],
  offices: [{ house_id: 'h2', office: 'archon', ends_at: at(3).toISOString(), in_office: true }],
  elections: [
    {
      id: 'e1',
      city_id: 'c1',
      office: 'archon',
      candidacy_opens_at: at(-5).toISOString(),
      voting_opens_at: at(-1).toISOString(),
      voting_closes_at: at(2).toISOString(),
      term_ends_at: at(30).toISOString(),
      tallied_at: null,
    },
  ],
  election_candidates: [{ id: 'k3', election_id: 'e1', house_id: 'h3', withdrawn_at: null }],
  decrees: [
    {
      id: 'd1',
      city_id: 'c1',
      model: 'public_works',
      params: { amountOboles: 600 },
      proposed_by: 'h2',
      status: 'proposed',
      proposed_at: at(-1).toISOString(),
      voting_closes_at: at(1).toISOString(),
      quorum_bps: 2000,
      tallied_at: null,
      electorate: null,
      votes_for: null,
      votes_against: null,
      applied_at: null,
    },
  ],
};
vi.mock('../supabase', () => ({
  supabase: {
    from: (view: string) => {
      calls.reads.set(view, (calls.reads.get(view) ?? 0) + 1);
      let ids: string[] | null = null;
      const query: Record<string, unknown> = {
        in: (column: string, values: string[]) => {
          if (view === 'houses' && column === 'id') calls.houseIds.push((ids = values));
          return query;
        },
        then: (ok: (v: unknown) => unknown) =>
          ok({
            data: (data[view] ?? []).filter(
              (row) => !ids || ids.includes((row as { id: string }).id),
            ),
          }),
      };
      for (const step of ['select', 'eq', 'gt', 'order', 'limit']) query[step] = () => query;
      return query;
    },
  },
}));
vi.mock('../server-clock', () => ({
  serverClock: { now: () => new Date(Date.now() + 1) },
  syncServerClock: () => Promise.resolve(),
}));
const { CityPolitics } = await import('./CityPolitics');
const { CityAssembly } = await import('./CityAssembly');
afterEach(() => {
  vi.useRealTimers();
  calls.reads.clear();
  calls.houseIds = [];
});

async function show(card: ReactNode) {
  vi.useFakeTimers({ now: at(0) });
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({ resources: { fr: { translation: fr } }, lng: 'fr' });
  const house = { id: 'h1', name: 'T', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        {card}
      </HouseProvider>
    </I18nextProvider>,
  );
}

describe('onglet Cité : lectures bornées des maisons citées (#441)', () => {
  it('vie politique : une lecture des maisons citées, une fois connues, puis plus rien', async () => {
    await show(<CityPolitics />);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText(/^Archonte en charge : Maison Zeus, jusqu'au /)).toBeTruthy();
    expect(screen.getByText('Maison Zoé')).toBeTruthy();
    expect(screen.getByText('Citoyen à Kallistè')).toBeTruthy();
    expect(calls.houseIds).toEqual([['h1', 'h2', 'h3']]);
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(calls.reads.get('houses')).toBe(1);
  });

  it('assemblée : une lecture des auteurs des décrets au vote, puis plus rien', async () => {
    await show(<CityAssembly />);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText(/^Proposé par Maison Zeus ; vote clos le /)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Voter pour : Grands travaux/ })).toBeTruthy();
    expect(calls.houseIds).toEqual([['h1', 'h2']]);
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(calls.reads.get('houses')).toBe(1);
  });
});
