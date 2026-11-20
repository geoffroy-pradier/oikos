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

async function mount(ships: ShipRow[], balance: number | null = null) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { name: 'Test', cityId: 'k', accessToken: 't', cityName: 'Kallistè' };
  const tree = (rows: ShipRow[], cash = balance) => (
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, id: `h${houseNumber}`, cityNames: {}, citizenshipStatus: 'metic' }}
      >
        <Shipyard
          ships={rows}
          rules={RULES}
          balance={cash}
          reloadShips={() => Promise.resolve(fleet)}
          reloadFleet={() => Promise.resolve()}
        />
      </HouseProvider>
    </I18nextProvider>
  );
  return { ...render(tree(ships)), tree };
}
// L'achat s'ouvre dans une feuille, au prix vu, puis se confirme.
const buy = () => {
  fireEvent.click(screen.getByRole('button', { name: /Acheter — 400 drachmes/ }));
  fireEvent.click(screen.getByRole('button', { name: "Confirmer l'achat — 400 drachmes" }));
};
beforeEach(() => {
  houseNumber += 1;
  sent.keys = [];
  sent.answers = [];
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('achat d’un navire, comme l’acquisition d’un site', () => {
  it('au-delà de la trésorerie : « Acheter » inactif, ce qui manque dit et relié ; actif dès qu’elle suffit', async () => {
    const view = await mount([], 2_918);
    const big = screen.getByRole('button', { name: /^Acheter — 1.000 drachmes$/ });
    expect(big.getAttribute('aria-disabled')).toBe('true');
    expect(big.getAttribute('aria-describedby')).toBeTruthy();
    const why = document.getElementById(big.getAttribute('aria-describedby') ?? '');
    expect(why?.textContent).toBe('Il manque 513 drachmes 4 oboles à votre trésorerie.');
    fireEvent.click(big);
    expect(screen.queryByRole('dialog')).toBeNull();
    // Le caboteur, payable, reste actif.
    const small = screen.getByRole('button', { name: /Acheter — 400 drachmes/ });
    expect(small.hasAttribute('aria-disabled')).toBe(false);
    view.rerender(view.tree([], 6_000));
    expect(big.hasAttribute('aria-disabled')).toBe(false);
    expect(big.hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(big);
    expect(screen.getByRole('dialog', { name: 'Acheter : Navire rond' })).toBeTruthy();
  });

  it('la feuille d’achat dit prix, cale et entretien ; la refermer n’achète rien', async () => {
    await mount([]);
    fireEvent.click(screen.getByRole('button', { name: /Acheter — 400 drachmes/ }));
    const sheet = screen.getByRole('dialog', { name: 'Acheter : Caboteur' });
    expect(sheet.textContent).toMatch(/Prix, payé une fois400 drachmes/);
    expect(sheet.textContent).toMatch(/Cargaison, en unités300/);
    expect(sheet.textContent).toMatch(/Entretien par jour3 drachmes/);
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent.keys).toEqual([]);
  });

  it('sans réponse, mais un navire de plus à la relecture : la même clé repart une fois', async () => {
    sent.answers.push(lost, bought);
    fleet = [ship('s1')];
    await mount([]);
    buy();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('déjà abouti'));
    // La feuille fermée, le foyer va au message qui dit l'issue. Il y va par un effet passif, après celui qui rend
    // le foyer à l'ouvreur en fermant la feuille : le texte peut paraître un instant avant lui.
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('status')));
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
