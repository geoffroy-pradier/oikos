// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { ECONOMY } from '../test/fakes';
import { Economy } from './Economy';

const adminGet = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ adminGet }));

let i18n: Awaited<ReturnType<typeof initI18n>>;
beforeAll(async () => {
  i18n = await initI18n('fr');
});
beforeEach(() => adminGet.mockReset());
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('fr');
});

/** Texte lu à l'écran : les espaces insécables et fines des nombres deviennent des espaces simples. */
const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s/g, ' ');
/** Les quatre chiffres de l'indice, avec ou sans leur intitulé. */
const figures = (part = 'div') => Array.from(document.querySelectorAll(`dl.grid ${part}`), text);
const rows = (name: string | RegExp) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .map((row) => Array.from(row.children, text));
type Index = (typeof ECONOMY)['worlds'][number]['priceIndex'];
/** Affiche le monde de démonstration, avec l'indice ou la masse donnés. */
async function show(priceIndex: Partial<Index> = {}, other = 0) {
  cleanup();
  const world = ECONOMY.worlds[0];
  if (!world) throw new Error('fixture without a world');
  const moneySupply = { ...world.moneySupply, other };
  const shown = { ...world, moneySupply, priceIndex: { ...world.priceIndex, ...priceIndex } };
  adminGet.mockResolvedValue({ ok: true, data: { ...ECONOMY, worlds: [shown] } });
  render(<Economy accessToken="token" />);
  await screen.findByRole('heading', { name: 'Monde « archipel »' });
}

it('une lecture sans réponse le dit, et « Réessayer » la relance', async () => {
  adminGet.mockResolvedValueOnce({ ok: false, code: 'NETWORK' });
  adminGet.mockResolvedValue({ ok: true, data: ECONOMY });
  render(<Economy accessToken="token" />);
  expect((await screen.findByRole('alert')).textContent).toMatch(/^L'API ne répond pas\./);
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByRole('table', { name: 'Masse monétaire' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(adminGet.mock.calls).toEqual(Array(2).fill(['economy', 'token']));
});

it('dans la cible : indice, masse par nature, nets négatifs et jours du plus récent au plus ancien', async () => {
  await show();
  expect(figures()).toEqual([
    'Indice des prix, 30 derniers jours (référence : 100)112,12',
    'Indice des prix, 30 jours précédents109,09',
    'Inflation sur 30 jours+2,78 %',
    "Situation de l'inflationDans la cible (0 % à 3 %)",
  ]);
  expect(screen.queryByRole('alert')).toBeNull();
  // Sans « autres comptes » quand il n'y en a pas ; le total en dernier.
  expect(rows('Masse monétaire')).toEqual([
    ['Trésoreries des maisons', '5 543'],
    ["Séquestres de l'agora", '70'],
    ['Trésors des cités', '2'],
    ['Total', '5 615'],
  ]);
  // Net négatif affiché avec son signe ; compte inconnu de l'écran : sa clé.
  expect(rows(/^Robinets et puits : net depuis/)).toEqual([
    ['Dotation de départ (robinet)', '6 000'],
    ['Prêts du Trésor du temple (robinet)', '-200'],
    ['Entretien des sites (puits)', '185'],
    ['sink_future (puits)', '0'],
  ]);
  expect(screen.getByRole('heading', { name: /jours lus : 30\)$/ })).toBeTruthy();
  const cards = screen.getAllByRole('heading', { level: 4 }).map((day) => text(day.parentElement));
  expect(cards).toEqual([
    '15 nov. 2026Dotation de départ (robinet)6 000Entretien des sites (puits)155',
    '14 nov. 2026Prêts du Trésor du temple (robinet)-200Entretien des sites (puits)30',
  ]);
  await show({}, -4);
  expect(rows('Masse monétaire')[3]).toEqual(['Autres comptes', '-4']);
});

it('hors de la cible : une alerte écrite dit l’inflation, le sens de l’écart et la cible', async () => {
  await show({ inflationBps: 420, status: 'above' });
  expect(text(screen.getByRole('alert'))).toBe(
    'Alerte : inflation de +4,2 % sur 30 jours. Au-dessus de la cible (0 % à 3 %).',
  );
  await show({ inflationBps: -150, status: 'below' });
  expect(text(screen.getByRole('alert'))).toBe(
    'Alerte : inflation de -1,5 % sur 30 jours. Sous la cible (0 % à 3 %).',
  );
  expect(figures('dd')[3]).toBe('Sous la cible (0 % à 3 %)');
  await i18n.changeLanguage('en');
  expect(text(screen.getByRole('alert'))).toMatch(
    /^Alert: inflation of -1\.5% over 30 days\. Below/,
  );
  expect(screen.getAllByText('Site upkeep (sink)')).toHaveLength(3);
});

it('mesure inconnue : dite telle, sans alerte, avec les biens du panier sans échange', async () => {
  const unknown = { previousBps: null, inflationBps: null, status: 'unknown' } as const;
  await show({ ...unknown, unpricedGoods: ['wheat', 'bread'] });
  expect(figures('dd')).toEqual(['112,12', 'Sans mesure', 'Sans mesure', 'Sans mesure']);
  expect(screen.getByText(/^Mesure incomplète : .* pour wheat et bread /)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  await show({ ...unknown, currentBps: null });
  expect(screen.getByText(/^Mesure impossible : .* pas de panier de référence\.$/)).toBeTruthy();
});
