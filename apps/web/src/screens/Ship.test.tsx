// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Lectures simulées, par vue ; chaque rendu relit l'état courant du test.
const views = vi.hoisted(() => ({ rows: {} as Record<string, object[]>, rules: null as unknown }));
vi.mock('../data', () => ({
  useRows: (view: string) => ({
    rows: views.rows[view] ?? [],
    failed: false,
    reload: () => Promise.resolve(null),
  }),
  useShipRules: () => ({ rules: views.rules, failed: false, reload: () => Promise.resolve() }),
}));
vi.mock('../server-clock', () => ({
  serverClock: { now: () => new Date('2026-11-16T12:00:00Z') },
  syncServerClock: () => Promise.resolve(),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useParams: () => ({ shipId: 's1' }),
}));
// Formulaire de départ simulé : il disparaît à l'envoi, comme quand le navire prend la mer.
vi.mock('./Departure', async () => {
  const { useState } = await import('react');
  return {
    Departure: (props: { onDone: (notice: object) => Promise<unknown> }) => {
      const [sent, setSent] = useState(false);
      return sent ? null : (
        <button
          onClick={() => {
            setSent(true);
            void props.onDone({ kind: 'status', text: 'Parti.' });
          }}
        >
          Partir
        </button>
      );
    },
  };
});
const { ShipScreen } = await import('./Ship');

const voyage = {
  id: 'v1',
  ship_id: 's1',
  from_city_id: 'k',
  to_city_id: 'e',
  departed_at: '2026-11-16T10:00:00Z',
  arrives_at: '2026-11-16T14:00:00Z',
  arrived_at: null as string | null,
  cargo: [{ goodId: 'wheat', quantity: 30 }],
};
function state(arrived: boolean) {
  views.rows = {
    my_ships: [
      {
        id: 's1',
        class_id: 'coaster',
        docked_city_id: arrived ? 'e' : null,
        laid_up_at: null,
      },
    ],
    my_voyages: [{ ...voyage, arrived_at: arrived ? '2026-11-16T14:00:00Z' : null }],
  };
}
async function screenOf() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'k', accessToken: 't', cityName: 'Kallistè' };
  const tree = () => (
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { k: 'Kallistè', e: 'Elaia' }, citizenshipStatus: 'metic' }}
      >
        <ShipScreen />
      </HouseProvider>
    </I18nextProvider>
  );
  return { ...render(tree()), tree };
}
afterEach(cleanup);

describe('fiche d’un navire', () => {
  it('fiche du voyage en cours : départ, arrivée prévue, cargaison ; rien d’annoncé à l’ouverture', async () => {
    state(false);
    await screenOf();
    expect(screen.getByRole('heading', { name: 'Caboteur' })).toBeTruthy();
    expect(screen.getByText('Kallistè → Elaia')).toBeTruthy();
    expect(screen.getByText(fr.ship.arrivesAt)).toBeTruthy();
    expect(screen.getByText('30 × Blé')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('un voyage arrivé entre deux lectures est annoncé à la relecture', async () => {
    state(false);
    const { rerender, tree } = await screenOf();
    state(true);
    rerender(tree());
    expect(screen.getByRole('status').textContent).toBe(
      'Navire arrivé à Elaia : 30 × Blé, déchargé dans votre stock.',
    );
    expect(screen.getByText('à quai à Elaia')).toBeTruthy();
    expect(screen.getByText(fr.ship.arrivedAt)).toBeTruthy();
  });

  it('un voyage déjà arrivé à l’ouverture se lit dans la liste, sans annonce', async () => {
    state(true);
    await screenOf();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText(fr.ship.arrivedAt)).toBeTruthy();
  });

  it('après un départ, le foyer perdu avec le formulaire va au message qui l’annonce', async () => {
    state(true);
    views.rules = { classes: [], routes: [], portDues: {} };
    await screenOf();
    const button = screen.getByRole('button', { name: 'Partir' });
    button.focus();
    fireEvent.click(button);
    const status = await screen.findByText('Parti.');
    expect(document.activeElement).toBe(status);
    views.rules = null;
  });
});
