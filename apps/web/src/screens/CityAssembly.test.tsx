// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Assemblée de l'onglet Cité (#264) : lectures simulées vue par vue.
const state = vi.hoisted(() => ({ views: {} as Record<string, unknown[] | null> }));
vi.mock('../data', () => ({
  useRows: (view: string) => {
    const rows = view in state.views ? (state.views[view] ?? null) : [];
    return { rows, failed: rows === null, reload: () => Promise.resolve(rows) };
  },
}));
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
afterEach(() => {
  cleanup();
  state.views = {};
});

describe('assemblée de la cité (#264)', () => {
  it('décret au vote : ce qu’il dit, qui l’a proposé, quand le vote se clôt', async () => {
    state.views = {
      houses,
      decrees: [decree('d1', 'proposed', 'market_tax_rate', { rateBps: 800 })],
    };
    await show();
    expect(screen.getByText(/^Taxe de marché de la cité à 8\s?%$/)).toBeTruthy();
    expect(screen.getByText(/^Proposé par Maison Alpha ; vote clos le /)).toBeTruthy();
    expect(screen.queryByText(fr.assembly.meticNotice)).toBeNull();
    expect(screen.getByText(fr.assembly.noPassed)).toBeTruthy();
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
    expect(screen.getByText(/^En vigueur depuis le /)).toBeTruthy();
    expect(screen.getByText('Fête de 2 jours : 100 drachmes, pour Pain, Vin')).toBeTruthy();
    expect(screen.getByText(fr.assembly.status.adopted)).toBeTruthy();
    expect(screen.getByText(/^Grands travaux : 1\s?000 drachmes$/)).toBeTruthy();
    expect(screen.getByText(fr.assembly.status.lapsed)).toBeTruthy();
    expect(screen.getByText('Décret illisible (market_tax_rate)')).toBeTruthy();
    expect(screen.getAllByText('Pour : 3 ; contre : 1 ; citoyens : 5')).toHaveLength(4);
    expect(screen.getByText(fr.assembly.noOpen)).toBeTruthy();
  });

  it('un métèque voit les décrets au vote, et l’écran dit pourquoi il ne vote pas ; lecture en échec annoncée', async () => {
    state.views = {
      houses: [{ ...houses[0], citizenship_status: 'metic' }, houses[1]],
      decrees: [decree('d1', 'proposed', 'public_works', { amountOboles: 600 })],
    };
    await show();
    expect(screen.getByText(fr.assembly.meticNotice)).toBeTruthy();
    expect(screen.getByText('Grands travaux : 100 drachmes')).toBeTruthy();
    cleanup();
    state.views = { decrees: null };
    await show();
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeTruthy();
  });
});
