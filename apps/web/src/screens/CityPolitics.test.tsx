// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Vie politique de l'onglet Cité (#264) : lectures simulées vue par vue.
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
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
async function show(status: 'metic' | 'citizen' = 'citizen') {
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
        <CityPolitics />
      </HouseProvider>
    </I18nextProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.views = {};
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
});
