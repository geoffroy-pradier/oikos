// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider, type HouseSummary } from '../house';
import fr from '../locales/fr.json';

// Ostracisme de l'onglet Cité (#723) : lectures simulées vue par vue.
const state = vi.hoisted(() => ({
  views: {} as Record<string, unknown[] | null>,
  columns: {} as Record<string, string>,
  houseFilters: [] as unknown[],
}));
vi.mock('../api', () => ({ cityCommand: vi.fn() }));
vi.mock('../data', () => ({
  useRows: (view: string, columns: string, _order: string, filters: unknown = {}) => {
    state.columns[view] = columns;
    if (view === 'houses') state.houseFilters.push(filters);
    if (view === 'houses' && filters === null)
      return { rows: null, failed: false, reload: () => Promise.resolve(null) };
    let rows = view in state.views ? (state.views[view] ?? null) : [];
    const ids = (filters as { id?: string[] } | null)?.id;
    if (view === 'houses' && rows && ids)
      rows = (rows as { id: string }[]).filter((row) => ids.includes(row.id));
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/maison">{children}</a>,
}));
const { CityOstracism } = await import('./CityOstracism');

const vote = (extra = {}) => ({
  id: 'o1',
  city_id: 'c1',
  opened_at: '2026-11-20T04:00:00+00:00',
  voting_closes_at: '2999-01-01T04:00:00+00:00',
  quorum_bps: 2000,
  tallied_at: null,
  electorate: null,
  ballots: null,
  outcome: null,
  ostracized_house_id: null,
  ends_at: null,
  in_force: false,
  ...extra,
});
const tallied = (extra = {}) =>
  vote({
    voting_closes_at: '2026-11-21T04:00:00+00:00',
    tallied_at: '2026-11-21T05:00:00+00:00',
    electorate: 7,
    ballots: 5,
    ...extra,
  });
const houses = [
  { id: 'h1', name: 'Maison Test', citizenship_status: 'citizen' },
  { id: 'h2', name: 'Alcméonides', citizenship_status: 'citizen' },
  { id: 'h3', name: 'Philaïdes', citizenship_status: 'citizen' },
];
const plain = (node: HTMLElement | null) => node?.textContent?.replace(/\p{Zs}/gu, ' ');

async function show(status: HouseSummary['citizenshipStatus'] = 'citizen') {
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
        <CityOstracism />
      </HouseProvider>
    </I18nextProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.views = {};
  state.houseFilters = [];
});

describe('ostracisme de la cité (#723)', () => {
  it('aucun vote : un état vide ; une lecture en échec : une erreur, jamais le vide', async () => {
    state.views = { ostracisms: [] };
    await show();
    expect(screen.getByText(/^Aucun ostracisme n'a été ouvert/)).toBeTruthy();
    cleanup();
    state.views = { ostracisms: null };
    await show();
    expect(screen.queryByText(/^Aucun ostracisme n'a été ouvert/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('au vote, une citoyenne qui n’a pas voté choisit un citoyen dans la liste filtrable de sa cité', async () => {
    state.views = { ostracisms: [vote()], houses };
    await show();
    expect(plain(screen.getByText(/^Vote ouvert jusqu'au /))).toMatch(
      /Il compte si 20 % des citoyens au moins/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Inscrire un nom' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Inscrire un nom' }));
    expect(sheet.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual(
      ['Alcméonides', 'Maison Test (votre maison)', 'Philaïdes'],
    );
    // Les citoyens de la cité seulement : le filtre de la lecture le dit.
    expect(state.houseFilters).toContainEqual({ city_id: 'c1', citizenship_status: 'citizen' });
  });

  it('une maison qui a voté le lit, sans nom ni bouton ; la lecture ne demande jamais le nom inscrit', async () => {
    state.views = {
      ostracisms: [vote()],
      houses,
      my_ostraca: [{ ostracism_id: 'o1', cast_at: '2026-11-21T09:00:00+00:00' }],
    };
    await show();
    expect(plain(screen.getByText(/^Votre maison a voté le /))).toContain(
      "Le vote est secret : le nom inscrit n'est pas affiché.",
    );
    expect(screen.queryByRole('button', { name: 'Inscrire un nom' })).toBeNull();
    expect(state.columns['my_ostraca']).toBe('ostracism_id, cast_at');
    expect(state.columns['ostracism_results']).not.toMatch(/target/);
  });

  it('un métèque voit le vote, sans bouton, et sait pourquoi ; aucun citoyen n’est lu pour lui', async () => {
    state.views = {
      ostracisms: [vote()],
      houses: houses.map((entry) =>
        entry.id === 'h1' ? { ...entry, citizenship_status: 'metic' } : entry,
      ),
    };
    await show('metic');
    expect(screen.getByText("Métèque, votre maison ne vote pas l'ostracisme.")).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(state.houseFilters).not.toContainEqual({ city_id: 'c1', citizenship_status: 'citizen' });
  });

  it('la citoyenneté se relit dans la vue des maisons : devenue citoyenne depuis la fondation, la maison vote', async () => {
    state.views = { ostracisms: [vote()], houses };
    await show('metic');
    expect(screen.getByRole('button', { name: 'Inscrire un nom' })).toBeTruthy();
    expect(screen.queryByText(/^Métèque, votre maison ne vote pas/)).toBeNull();
  });

  it('vote clos, pas encore dépouillé : annoncé, sans décompte', async () => {
    state.views = {
      ostracisms: [vote({ voting_closes_at: '2020-01-01T04:00:00+00:00' })],
      ostracism_results: [{ ostracism_id: 'o1', house_id: 'h2', ostraca: 3 }],
    };
    await show();
    expect(
      screen.getByText(/^Le vote est clos\. Il sera dépouillé à la prochaine clôture/),
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('dépouillé : le panneau montre l’issue et le décompte lus, sans bouton de vote', async () => {
    state.views = {
      ostracisms: [
        tallied({
          outcome: 'ostracized',
          ostracized_house_id: 'h2',
          ends_at: '2999-02-01T04:00:00+00:00',
          in_force: true,
        }),
      ],
      houses,
      ostracism_results: [
        { ostracism_id: 'o1', house_id: 'h3', ostraca: 1 },
        { ostracism_id: 'o1', house_id: 'h2', ostraca: 4 },
        { ostracism_id: 'autre', house_id: 'h1', ostraca: 9 },
      ],
    };
    await show();
    expect(screen.getByText(/^Alcméonides est ostracisée jusqu'au /)).toBeTruthy();
    expect(plain(screen.getByText('Bulletins').nextElementSibling as HTMLElement)).toBe('5');
    // Le décompte d'un autre vote n'est pas lu ici ; seules les maisons nommées le sont.
    expect(screen.queryByText('Maison Test')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Inscrire un nom' })).toBeNull();
  });
});
