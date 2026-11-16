// @vitest-environment jsdom
import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipRow } from '../fleet';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import { parseShipRules, type ShipRules } from '../ship-rules';

const sent = vi.hoisted(() => ({ keys: [] as string[], answers: [] as unknown[] }));
vi.mock('../api', () => ({
  acquireShip: (_classId: string, _cost: number, _token: string, key: string) => {
    sent.keys.push(key);
    return Promise.resolve(sent.answers.shift());
  },
}));
const { Shipyard } = await import('./Shipyard');

const RULES = parseShipRules({ ships: (INITIAL_CONFIG as GameConfig).ships }) as ShipRules;
const ship = (id: string): ShipRow => ({
  id,
  class_id: 'coaster',
  docked_city_id: 'k',
  laid_up_at: null,
});
const lost = { ok: false, error: { code: 'INTERNAL', message: '' } };
const bought = { ok: true, replayed: true, data: { costOboles: 2400 } };
// La flotte relue après l'envoi : ce que le test y met.
let fleet: ShipRow[] = [];
let houseNumber = 0;

async function mount(ships: ShipRow[]) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { name: 'Test', cityId: 'k', accessToken: 't', cityName: 'Kallistè' };
  const tree = (rows: ShipRow[]) => (
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, id: `h${houseNumber}`, cityNames: {}, citizenshipStatus: 'metic' }}
      >
        <Shipyard
          ships={rows}
          rules={RULES}
          reloadShips={() => Promise.resolve(fleet)}
          reloadFleet={() => Promise.resolve()}
        />
      </HouseProvider>
    </I18nextProvider>
  );
  return { ...render(tree(ships)), tree };
}
const buy = () => fireEvent.click(screen.getByRole('button', { name: /Acheter — 400 drachmes/ }));
beforeEach(() => {
  houseNumber += 1;
  sent.keys = [];
  sent.answers = [];
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('achat d’un navire, comme l’acquisition d’un site', () => {
  it('sans réponse, mais un navire de plus à la relecture : la même clé repart une fois', async () => {
    sent.answers.push(lost, bought);
    fleet = [ship('s1')];
    await mount([]);
    buy();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('déjà abouti'));
    expect(sent.keys).toHaveLength(2);
    expect(sent.keys[1]).toBe(sent.keys[0]);
  });

  it('réponse perdue puis un navire de plus : prévenu, rappelé à la réouverture, jusqu’à vérification', async () => {
    sent.answers.push(lost);
    fleet = [];
    const first = await mount([]);
    buy();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(fr.errors.INTERNAL));
    // La flotte relue plus tard montre un navire de plus : l'issue était inconnue, le joueur est prévenu.
    first.rerender(first.tree([ship('s1')]));
    expect(screen.getByRole('alert').textContent).toBe(fr.map.buyUnanswered);
    cleanup();
    const again = await mount([ship('s1')]);
    expect(screen.getByRole('alert').textContent).toBe(fr.map.buyUnanswered);
    fireEvent.click(screen.getByRole('button', { name: fr.map.buyChecked }));
    expect(screen.queryByRole('alert')).toBeNull();
    again.unmount();
    await mount([ship('s1')]);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
