// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CITED_HOUSE_READS } from '../cited-houses';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

// Vie politique de l'onglet Cité (#264) : lectures simulées vue par vue.
// La vue `houses` rend au plus 1 000 lignes par lecture, par ordre de nom, comme PostgREST (`max_rows`).
const state = vi.hoisted(() => ({
  views: {} as Record<string, unknown[] | null>,
  houseFilters: [] as unknown[],
  filters: {} as Record<string, unknown>,
}));
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, _order: string, filters: unknown = {}) => {
    if (view === 'houses') state.houseFilters.push(filters);
    state.filters[view] = filters;
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
vi.mock('./HouseLink', () => import('./house-link-mock'));
const { CityPolitics } = await import('./CityPolitics');

const day = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();
const election = (id = 'e1') => ({
  id,
  city_id: 'c1',
  office: 'archon',
  candidacy_opens_at: iso(-5),
  voting_opens_at: iso(-1),
  voting_closes_at: iso(2),
  term_ends_at: iso(30),
  tallied_at: null,
});
const houses = [
  { id: 'h1', name: 'Maison Test', citizenship_status: 'citizen' },
  { id: 'h2', name: 'Maison Alpha', citizenship_status: 'citizen' },
];
async function show(status: 'metic' | 'citizen' = 'citizen', lng: 'fr' | 'en' = 'fr') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: status }}>
        <CityPolitics />
      </HouseProvider>
    </I18nextProvider>,
  );
}
// Une cité de 1 500 maisons dont les noms passent avant ceux des maisons citées (#441).
const crowd = Array.from({ length: 1_500 }, (_, i) => ({
  id: `x${String(i).padStart(4, '0')}`,
  name: `Maison A${String(i).padStart(4, '0')}`,
  citizenship_status: 'citizen',
}));
afterEach(() => {
  cleanup();
  state.views = {};
  state.houseFilters = [];
  state.filters = {};
});

describe('vie politique de la cité (#264)', () => {
  it('statut relu, archonte en charge, élection en cours avec son calendrier et ses candidats', async () => {
    state.views = {
      houses,
      offices: [
        { house_id: 'h2', office: 'archon', ends_at: iso(3), in_office: true },
        { house_id: 'h1', office: 'archon', ends_at: iso(-25), in_office: false },
      ],
      elections: [election()],
      election_candidates: [
        { id: 'k2', election_id: 'e1', house_id: 'h2', withdrawn_at: null },
        { id: 'k1', election_id: 'e1', house_id: 'h1', withdrawn_at: iso(-3) },
      ],
    };
    // La coquille croit la maison métèque ; la vue `houses`, relue, la dit citoyenne.
    await show('metic');
    expect(screen.getByText('Citoyen à Kallistè')).toBeTruthy();
    expect(screen.queryByText(fr.cityPolitics.meticNotice)).toBeNull();
    expect(screen.getByText(/^Archonte en charge : Maison Alpha, jusqu'au /)).toBeTruthy();
    expect(screen.getByText("Élection de l'archonte : vote ouvert.")).toBeTruthy();
    expect(screen.getByText(/^Fin du vote le /)).toBeTruthy();
    expect(screen.getByText('Maison Alpha')).toBeTruthy();
    expect(screen.queryByText('Maison Test')).toBeNull();
    expect(screen.getByText(fr.cityPolitics.noResults)).toBeTruthy();
  });

  it('un métèque voit tout et l’écran dit pourquoi il ne vote pas ; résultats de la dernière élection', async () => {
    state.views = {
      houses: [{ ...houses[0], citizenship_status: 'metic' }, houses[1]],
      elections: [
        election(),
        { ...election('e0'), candidacy_opens_at: iso(-40), tallied_at: iso(-30) },
      ],
      election_results: [
        { election_id: 'e0', house_id: 'h1', votes: 1, elected: false },
        { election_id: 'e0', house_id: 'h2', votes: 3, elected: true },
      ],
    };
    await show();
    expect(screen.getByText('Métèque à Kallistè')).toBeTruthy();
    expect(screen.getByText(fr.cityPolitics.meticNotice)).toBeTruthy();
    expect(screen.getByText(fr.cityPolitics.noArchon)).toBeTruthy();
    const results = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(results.slice(-2)).toEqual(['Maison Alpha : 3 voix, élue', 'Maison Test : 1 voix']);
  });

  it('aucune élection en cours ; lecture en échec annoncée', async () => {
    state.views = { houses };
    await show();
    expect(screen.getByText(fr.cityPolitics.noElection)).toBeTruthy();
    cleanup();
    state.views = { elections: null };
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });

  it('au-delà de la millième maison : archonte, candidats, résultats et statut lus par identifiant (#441)', async () => {
    state.views = {
      houses: [
        ...crowd,
        { id: 'h1', name: 'Maison Zénon', citizenship_status: 'citizen' },
        { id: 'h2', name: 'Maison Zeus', citizenship_status: 'citizen' },
        { id: 'h3', name: 'Maison Zoé', citizenship_status: 'citizen' },
        { id: 'h4', name: 'Maison Zyx', citizenship_status: 'citizen' },
      ],
      offices: [{ house_id: 'h2', office: 'archon', ends_at: iso(3), in_office: true }],
      elections: [
        election(),
        { ...election('e0'), candidacy_opens_at: iso(-40), tallied_at: iso(-30) },
      ],
      election_candidates: [
        { id: 'k3', election_id: 'e1', house_id: 'h3', withdrawn_at: null },
        { id: 'k0', election_id: 'e1', house_id: 'x0001', withdrawn_at: iso(-3) },
      ],
      election_results: [{ election_id: 'e0', house_id: 'h4', votes: 2, elected: true }],
    };
    // La coquille croit la maison métèque ; sa propre ligne, relue, la dit citoyenne.
    await show('metic');
    expect(houseReads()).toEqual([{ id: ['h1', 'h2', 'h3', 'h4'] }]);
    expect(screen.getByText('Citoyen à Kallistè')).toBeTruthy();
    expect(screen.getByText(/^Archonte en charge : Maison Zeus, jusqu'au /)).toBeTruthy();
    expect(screen.getByText('Maison Zoé')).toBeTruthy();
    expect(screen.getByText('Maison Zyx : 2 voix, élue')).toBeTruthy();
    expect(screen.queryByText(fr.cityPolitics.unknownHouse, { exact: false })).toBeNull();
  });

  it('beaucoup de candidats : lus par paquets de 100, aucun ne s’affiche « Maison inconnue » (#441)', async () => {
    state.views = {
      houses: crowd,
      offices: [{ house_id: 'x1499', office: 'archon', ends_at: iso(3), in_office: true }],
      elections: [election()],
      election_candidates: crowd.slice(0, 300).map((row, i) => ({
        id: `k${String(i)}`,
        election_id: 'e1',
        house_id: row.id,
        withdrawn_at: null,
      })),
    };
    await show();
    const ids = houseReads().map((filter) => (filter as { id: string[] }).id);
    expect(ids.map((chunk) => chunk.length)).toEqual([100, 100, 100, 2]);
    expect(ids.flat()).toEqual([...ids.flat()].sort());
    expect(ids.flat()).toEqual(expect.arrayContaining(['h1', 'x1499', 'x0000', 'x0299']));
    expect(screen.getByText(/^Archonte en charge : Maison A1499, jusqu'au /)).toBeTruthy();
    expect(screen.getByText('Maison A0299')).toBeTruthy();
    // Chaque bouton de vote nomme son candidat : aucun n'est indiscernable des autres.
    expect(screen.getByRole('button', { name: /Maison A0299/ })).toBeTruthy();
    expect(screen.queryByText(fr.cityPolitics.unknownHouse, { exact: false })).toBeNull();
  });

  it('au-delà de 1 000 maisons citées : la sienne et l’archonte d’abord, les dernières inconnues (#441)', async () => {
    state.views = {
      houses: [...crowd, { id: 'h1', name: 'Maison Test', citizenship_status: 'citizen' }],
      offices: [{ house_id: 'x1499', office: 'archon', ends_at: iso(3), in_office: true }],
      elections: [election()],
      election_candidates: crowd.slice(0, 1_200).map((row, i) => ({
        id: `k${String(i)}`,
        election_id: 'e1',
        house_id: row.id,
        withdrawn_at: null,
      })),
    };
    await show();
    const ids = houseReads().flatMap((filter) => (filter as { id: string[] }).id);
    expect(houseReads()).toHaveLength(CITED_HOUSE_READS);
    expect(ids).toHaveLength(1_000);
    expect(ids).toEqual(expect.arrayContaining(['h1', 'x1499', 'x0997']));
    expect(ids).not.toContain('x0998');
    expect(screen.getByText('Citoyen à Kallistè')).toBeTruthy();
    expect(screen.getByText(/^Archonte en charge : Maison A1499, jusqu'au /)).toBeTruthy();
    expect(screen.getByText('Maison A0997')).toBeTruthy();
    expect(screen.getAllByText(fr.cityPolitics.unknownHouse)).toHaveLength(202);
  });
});

describe('statut de la maison et sa date (#420)', () => {
  // Jour de jeu du 29 mars 2026 (jours depuis 1970-01-01).
  const day29 = Date.UTC(2026, 2, 29) / day;
  const mine = (status: string, since_day: number | null, since = '2026-03-29T02:00:00Z') => ({
    house_id: 'h1',
    status,
    since,
    since_day,
  });

  it('citoyenne depuis le jour de jeu de son statut, lu dans sa propre ligne', async () => {
    // `houses` dit encore métèque : le statut daté de `my_citizenships` prime, boutons compris.
    state.views = {
      houses: [{ ...houses[0], citizenship_status: 'metic' }, houses[1]],
      elections: [election()],
      election_candidates: [{ id: 'k2', election_id: 'e1', house_id: 'h2', withdrawn_at: null }],
      my_citizenships: [mine('citizen', day29)],
    };
    await show('metic');
    expect(state.filters.my_citizenships).toEqual({ house_id: 'h1' });
    expect(screen.getByText('Citoyenne à Kallistè depuis le 29 mars 2026')).toBeTruthy();
    expect(screen.queryByText(fr.cityPolitics.meticNotice)).toBeNull();
    expect(screen.getByRole('button', { name: /Maison Alpha/ })).toBeTruthy();
  });

  it('métèque depuis le jour de jeu de la veille, en français et en anglais', async () => {
    state.views = { houses, my_citizenships: [mine('metic', day29 - 1, '2026-03-29T01:59:59Z')] };
    await show();
    expect(screen.getByText('Métèque à Kallistè depuis le 28 mars 2026')).toBeTruthy();
    expect(screen.getByText(fr.cityPolitics.meticNotice)).toBeTruthy();
    cleanup();
    await show('citizen', 'en');
    expect(screen.getByText('Metic in Kallistè since March 28, 2026')).toBeTruthy();
    cleanup();
    state.views = { houses, my_citizenships: [mine('citizen', day29)] };
    await show('citizen', 'en');
    expect(screen.getByText('Citizen in Kallistè since March 29, 2026')).toBeTruthy();
  });

  it('sans horloge en vigueur : le jour local de l’instant', async () => {
    state.views = { houses, my_citizenships: [mine('citizen', null, '2026-03-29T12:00:00Z')] };
    await show();
    const local = new Intl.DateTimeFormat('fr', { dateStyle: 'long' }).format(
      Date.parse('2026-03-29T12:00:00Z'),
    );
    expect(screen.getByText(`Citoyenne à Kallistè depuis le ${local}`)).toBeTruthy();
  });

  it('sans ligne pour la maison : le statut sans date ; ligne illisible : lecture en échec', async () => {
    state.views = { houses, my_citizenships: [{ ...mine('metic', day29), house_id: 'h2' }] };
    await show();
    expect(screen.getByText('Citoyen à Kallistè')).toBeTruthy();
    expect(screen.queryByText(/depuis le/)).toBeNull();
    cleanup();
    state.views = { houses, my_citizenships: [mine('exile', day29)] };
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
    cleanup();
    state.views = { houses, my_citizenships: null };
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });

  it('carte de l’élection : l’étape en cours du calendrier, les candidatures comptées, le bulletin en cartes (#697)', async () => {
    state.views = {
      houses,
      elections: [election()],
      election_candidates: [{ id: 'k2', election_id: 'e1', house_id: 'h2', withdrawn_at: null }],
    };
    await show();
    const steps = screen.getAllByRole('listitem').filter((item) => item.closest('ol'));
    expect(steps.map((item) => item.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(steps[1]?.textContent).toMatch(/^Vote à partir du /);
    expect(screen.getByRole('heading', { name: '1 candidature', level: 4 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: fr.cityPolitics.ballot, level: 4 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voter pour Maison Alpha' })).toBeTruthy();
  });
});
