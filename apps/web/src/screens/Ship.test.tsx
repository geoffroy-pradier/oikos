// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Lectures simulées, par vue ; chaque rendu relit l'état courant du test.
const views = vi.hoisted(() => ({
  rows: {} as Record<string, object[]>,
  rules: null as unknown,
  filters: {} as Record<string, unknown>,
  reload: (() => Promise.resolve(null)) as () => Promise<unknown>,
}));
// Une référence stable : `useFleet` relance son effet (et l'heure) à chaque nouvelle référence.
const stableReload = () => views.reload();
vi.mock('../data', () => ({
  useRows: (view: string, _columns: string, _order: string, filters?: unknown) => {
    views.filters[view] = filters;
    return { rows: views.rows[view] ?? [], failed: false, reload: stableReload };
  },
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
    Departure: (props: {
      onDone: (notice: object) => Promise<unknown>;
      onBusyChange: (busy: boolean) => void;
    }) => {
      const [sent, setSent] = useState(false);
      return sent ? null : (
        <>
          <button
            onClick={() => {
              setSent(true);
              void props.onDone({ kind: 'status', text: 'Parti.' });
            }}
          >
            Partir
          </button>
          <button onClick={() => props.onBusyChange(true)}>En vol</button>
        </>
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
        value={{
          ...house,
          cityNames: { k: 'Kallistè', e: 'Elaia' },
          citySlugs: { k: 'kalliste', e: 'elaia' },
          citizenshipStatus: 'metic',
        }}
      >
        <ShipScreen />
      </HouseProvider>
    </I18nextProvider>
  );
  return { ...render(tree()), tree };
}
afterEach(cleanup);
// Annonces faites (la région du tri des voyages, toujours présente, reste vide).
const announced = () =>
  screen
    .queryAllByRole('status')
    .map((region) => region.textContent)
    .filter(Boolean);
// Les voyages sont en fiches sur téléphone et en tableau sur ordinateur : chaque valeur, deux fois.
const shown = (text: string) => expect(screen.getAllByText(text)).toHaveLength(2);

describe('fiche d’un navire', () => {
  it('fiche du voyage en cours : départ, arrivée prévue, cargaison ; rien d’annoncé à l’ouverture', async () => {
    state(false);
    await screenOf();
    expect(screen.getByRole('heading', { name: 'Caboteur' })).toBeTruthy();
    shown('Kallistè → Elaia');
    shown(fr.ship.arrivesAt);
    shown('30 × Blé');
    expect(announced()).toEqual([]);
    // Droit de port en vigueur : lu pour les seules cités du monde de la maison.
    expect(views.filters['city_rates']).toEqual({ city_id: ['e', 'k'] });
  });

  it('un voyage arrivé entre deux lectures est annoncé à la relecture', async () => {
    state(false);
    const { rerender, tree } = await screenOf();
    state(true);
    rerender(tree());
    expect(announced()).toEqual(['Navire arrivé à Elaia : 30 × Blé, déchargé dans votre stock.']);
    expect(screen.getByText('à quai à Elaia')).toBeTruthy();
    shown(fr.ship.arrivedAt);
  });

  it('un voyage déjà arrivé à l’ouverture se lit dans la liste, sans annonce', async () => {
    state(true);
    await screenOf();
    expect(announced()).toEqual([]);
    shown(fr.ship.arrivedAt);
  });

  it('après un départ, la feuille se ferme et le foyer va au message qui l’annonce', async () => {
    state(true);
    views.rules = { classes: [], routes: [], portDues: {} };
    await screenOf();
    fireEvent.click(screen.getByRole('button', { name: fr.departure.open }));
    const button = screen.getByRole('button', { name: 'Partir' });
    button.focus();
    fireEvent.click(button);
    const status = await screen.findByText('Parti.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(status);
    views.rules = null;
  });

  it('une requête en vol garde la feuille ouverte : Fermer inactif, Échap sans effet, et dit pourquoi', async () => {
    state(true);
    views.rules = { classes: [], routes: [], portDues: {} };
    await screenOf();
    fireEvent.click(screen.getByRole('button', { name: fr.departure.open }));
    fireEvent.click(screen.getByRole('button', { name: 'En vol' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain(fr.departure.sending);
    expect(
      (screen.getByRole('button', { name: fr.shell.close }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBe(sheet);
    views.rules = null;
  });

  it('« Relire la flotte » : bouton occupé qui garde le foyer, puis issue annoncée sans changement', async () => {
    state(false);
    const pending: ((rows: unknown) => void)[] = [];
    const done = (rows: unknown) => pending.splice(0).forEach((resolve) => resolve(rows));
    let calls = 0;
    views.reload = () => {
      calls++;
      return new Promise((resolve) => pending.push(resolve));
    };
    await screenOf();
    const before = calls;
    const button = screen.getByRole('button', { name: fr.ship.reload });
    button.focus();
    fireEvent.click(button);
    expect(calls).toBeGreaterThan(before);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    const during = calls;
    fireEvent.click(button);
    expect(calls).toBe(during);
    await act(async () => done([]));
    await screen.findByText(fr.ship.reloaded);
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(announced()).toEqual([fr.ship.reloaded]);
    fireEvent.click(button);
    expect(announced()).toEqual([]);
    await act(async () => done([]));
    await screen.findByText(fr.ship.reloaded);
    expect(announced()).toEqual([fr.ship.reloaded]);
    views.reload = () => Promise.resolve(null);
  });

  it('« Relire la flotte » en échec : dit comme les autres échecs de lecture', async () => {
    state(false);
    views.reload = () => Promise.resolve(null);
    await screenOf();
    fireEvent.click(screen.getByRole('button', { name: fr.ship.reload }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(fr.app.loadFailed);
    expect(announced()).toEqual([]);
  });
});
