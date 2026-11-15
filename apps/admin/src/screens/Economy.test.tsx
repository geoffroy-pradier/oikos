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
type World = (typeof ECONOMY)['worlds'][number];
type Index = World['priceIndex'];
const WORLD = ECONOMY.worlds[0] as World;
/** Monde de démonstration, avec l'indice ou la masse donnés. */
const world = (priceIndex: Partial<Index> = {}, other = 0): World => ({
  ...WORLD,
  moneySupply: { ...WORLD.moneySupply, other },
  priceIndex: { ...WORLD.priceIndex, ...priceIndex },
});
/** Affiche la réponse de démonstration, avec les mondes et les champs donnés. */
async function showAll(worlds: World[], patch: Partial<typeof ECONOMY> = {}) {
  cleanup();
  adminGet.mockResolvedValue({ ok: true, data: { ...ECONOMY, ...patch, worlds } });
  render(<Economy accessToken="token" />);
  await screen.findByRole('heading', { name: `Monde « ${worlds[0]?.slug ?? ''} »` });
}
/** Affiche le monde de démonstration, avec l'indice ou la masse donnés. */
const show = (priceIndex: Partial<Index> = {}, other = 0) => showAll([world(priceIndex, other)]);

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
  // Jours détaillés (14) et fenêtre de prix (30) se lisent chacun à sa place.
  expect(screen.getByRole('heading', { name: /jours lus : 14\)$/ })).toBeTruthy();
  const cards = screen.getAllByRole('heading', { level: 4 }).map((day) => text(day.parentElement));
  expect(cards).toEqual([
    '15 nov. 2026Dotation de départ (robinet)6 000Entretien des sites (puits)155',
    '14 nov. 2026Prêts du Trésor du temple (robinet)-200Entretien des sites (puits)30',
  ]);
  await show({}, -4);
  expect(rows('Masse monétaire')[3]).toEqual(['Autres comptes', '-4']);
});

it('les jours de jeu se lisent en temps universel, même sous un fuseau à l’ouest de Greenwich', async () => {
  const zone = process.env['TZ'];
  process.env['TZ'] = 'America/Los_Angeles';
  try {
    // Minuit UTC du 15 novembre est encore le 14 à Los Angeles : le fuseau du poste ne compte pas.
    expect(new Date(20_772 * 86_400_000).getDate()).toBe(14);
    await show();
    const cards = screen.getAllByRole('heading', { level: 4 }).map((day) => day.textContent);
    expect(cards).toEqual(['15 nov. 2026', '14 nov. 2026']);
  } finally {
    if (zone === undefined) delete process.env['TZ'];
    else process.env['TZ'] = zone;
  }
});

it('sans mouvement sur la période : dit tel, sans liste vide', async () => {
  await showAll([{ ...world(), systemAccounts: [] }]);
  expect(screen.getByText('Aucun mouvement sur la période.')).toBeTruthy();
  expect(screen.queryByRole('list')).toBeNull();
});

it('une clé de compte inconnue et longue peut passer à la ligne n’importe où', async () => {
  const key = `sink_${'inconnu'.repeat(10)}`;
  const long: World['systemAccounts'][number] = {
    key,
    kind: 'sink',
    total: 3,
    days: [{ gameDay: 20_772, amount: 3 }],
  };
  await showAll([{ ...world(), systemAccounts: [...WORLD.systemAccounts, long] }]);
  // Rangée du cumul (th) et fiche du jour (dt) ; la mise en page elle-même est vérifiée à 360 px (e2e).
  const labels = screen.getAllByText(`${key} (puits)`);
  expect(labels.map((label) => label.tagName)).toEqual(['TH', 'DT']);
  for (const label of labels) expect(label.classList).toContain('wrap-anywhere');
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
});

it('« pas de panier » est lu dans la réponse, jamais déduit d’une liste de biens vide', async () => {
  const unknown = { currentBps: null, previousBps: null, inflationBps: null } as const;
  const none: Partial<Index> = { ...unknown, status: 'unknown', unpricedGoods: [] };
  await show(none);
  expect(screen.queryByText(/pas de panier de référence/)).toBeNull();
  expect(screen.queryByText(/^Mesure incomplète/)).toBeNull();
  await showAll([world(none)], { basketEmpty: true });
  expect(screen.getByText(/^Mesure impossible : .* pas de panier de référence\.$/)).toBeTruthy();
});
