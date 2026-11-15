// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const SUPPLY = 'Masse monétaire, monde « archipel »';
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
  expect(await screen.findByRole('table', { name: SUPPLY })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(adminGet.mock.calls).toEqual(Array(2).fill(['economy', 'token']));
});

it('un « Actualiser » en échec garde les chiffres et dit qu’ils sont anciens', async () => {
  const stale = /^Les chiffres affichés sont ceux de la lecture précédente/;
  await show();
  expect(screen.queryByText(stale)).toBeNull();
  adminGet.mockResolvedValueOnce({ ok: false, code: 'RATE_LIMITED' });
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/^Trop de demandes/);
  expect(screen.getByText(stale)).toBeTruthy();
  expect(rows(SUPPLY)[3]).toEqual(['Total', '5 615']);
  await i18n.changeLanguage('en');
  expect(screen.getByText(/^The figures shown come from the previous read/)).toBeTruthy();
  // Une lecture réussie efface l'avertissement.
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.queryByText(/^The figures shown/)).toBeNull();
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
  expect(rows(SUPPLY)).toEqual([
    ['Trésoreries des maisons', '5 543'],
    ["Séquestres de l'agora", '70'],
    ['Trésors des cités', '2'],
    ['Total', '5 615'],
  ]);
  // Net négatif affiché avec son signe ; compte inconnu de l'écran : sa clé.
  expect(rows("Robinets et puits : net depuis l'origine, monde « archipel »")).toEqual([
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
  expect(rows(SUPPLY)[3]).toEqual(['Autres comptes', '-4']);
  // L'indice garde ses deux décimales.
  await show({ currentBps: 10_000, previousBps: 11_210 });
  expect(figures('dd').slice(0, 2)).toEqual(['100,00', '112,10']);
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

it('une fenêtre d’un jour s’accorde au singulier ; sans mouvement, aucune liste vide', async () => {
  const quiet = { ...world({ inflationBps: 420, status: 'above' }), systemAccounts: [] };
  await showAll([quiet], { priceWindowDays: 1, windowDays: 1 });
  expect(figures('dt').slice(0, 3)).toEqual([
    'Indice des prix, dernier jour (référence : 100)',
    'Indice des prix, jour précédent',
    'Inflation sur 1 jour',
  ]);
  expect(text(screen.getByRole('alert'))).toBe(
    'Alerte : inflation de +4,2 % sur 1 jour. Au-dessus de la cible (0 % à 3 %).',
  );
  expect(screen.getByRole('heading', { name: /\(jour lu : 1\)$/ })).toBeTruthy();
  expect(screen.getByText('Aucun mouvement sur la période.')).toBeTruthy();
  expect(screen.queryByRole('list')).toBeNull();
  await i18n.changeLanguage('en');
  expect(text(screen.getByRole('alert'))).toBe(
    'Alert: inflation of +4.2% over 1 day. Above target (0% to 3%).',
  );
  expect(screen.getByRole('heading', { name: /\(day read: 1\)$/ })).toBeTruthy();
});

it('hors de la cible : une alerte écrite dit l’inflation, le sens de l’écart et la cible', async () => {
  await show({ inflationBps: 420, status: 'above' });
  expect(text(screen.getByRole('alert'))).toBe(
    'Alerte : inflation de +4,2 % sur 30 jours. Au-dessus de la cible (0 % à 3 %).',
  );
  await i18n.changeLanguage('en');
  expect(text(screen.getByRole('alert'))).toBe(
    'Alert: inflation of +4.2% over 30 days. Above target (0% to 3%).',
  );
  await i18n.changeLanguage('fr');
  await show({ inflationBps: -150, status: 'below' });
  expect(text(screen.getByRole('alert'))).toBe(
    'Alerte : inflation de -1,5 % sur 30 jours. Sous la cible (0 % à 3 %).',
  );
  expect(figures('dd')[3]).toBe('Sous la cible (0 % à 3 %)');
  await i18n.changeLanguage('en');
  expect(text(screen.getByRole('alert'))).toBe(
    'Alert: inflation of -1.5% over 30 days. Below target (0% to 3%).',
  );
  expect(screen.getAllByText('Site upkeep (sink)')).toHaveLength(3);
});

it('mesure inconnue : dite telle, sans alerte, avec la fenêtre en cause pour chaque bien sans échange', async () => {
  const unknown = { previousBps: null, inflationBps: null, status: 'unknown' } as const;
  const unpricedByWindow = { current: ['wheat'], previous: ['wheat', 'bread'] };
  await show({ ...unknown, unpricedGoods: ['wheat', 'bread'], unpricedByWindow });
  expect(figures('dd')).toEqual(['112,12', 'Sans mesure', 'Sans mesure', 'Sans mesure']);
  expect(
    screen.getByText(/^Mesure incomplète\. Biens du panier de référence sans échange/),
  ).toBeTruthy();
  const goods = () => screen.getAllByRole('listitem').map((item) => text(item));
  expect(goods().slice(0, 2)).toEqual([
    'wheat : 30 derniers jours et 30 jours précédents',
    'bread : 30 jours précédents',
  ]);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(/pas de panier/)).toBeNull();
  await i18n.changeLanguage('en');
  expect(goods().slice(0, 2)).toEqual([
    'wheat: last 30 days and previous 30 days',
    'bread: previous 30 days',
  ]);
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

it('fenêtre partielle : dite à côté de l’indice et dans l’alerte, en français et en anglais', async () => {
  await show({ inflationBps: 420, status: 'above', partialWindow: 'previous' });
  const previous =
    "La fenêtre précédente ne couvre qu'une partie des 30 jours : l'historique des prix de ce monde commence à l'intérieur.";
  expect(text(screen.getByRole('alert'))).toBe(
    `Alerte : inflation de +4,2 % sur 30 jours. Au-dessus de la cible (0 % à 3 %). ${previous}`,
  );
  // Juste après les chiffres de l'indice.
  expect(text(document.querySelector('dl.grid')?.nextElementSibling)).toBe(previous);
  await i18n.changeLanguage('en');
  expect(text(screen.getByRole('alert'))).toMatch(
    /3%\)\. The previous window covers only part of the 30 days: this world's price history starts inside it\.$/,
  );
  await i18n.changeLanguage('fr');
  const unknown = { previousBps: null, inflationBps: null, status: 'unknown' } as const;
  const empty = { current: [], previous: ['wheat'] };
  await show({
    ...unknown,
    unpricedGoods: ['wheat'],
    unpricedByWindow: empty,
    partialWindow: 'current',
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(text(document.querySelector('dl.grid')?.nextElementSibling)).toBe(
    "La fenêtre courante ne couvre qu'une partie des 30 jours : l'historique des prix de ce monde commence à l'intérieur.",
  );
  await i18n.changeLanguage('en');
  expect(text(document.querySelector('dl.grid')?.nextElementSibling)).toBe(
    "The current window covers only part of the 30 days: this world's price history starts inside it.",
  );
  await i18n.changeLanguage('fr');
  await show();
  expect(screen.queryByText(/ne couvre qu'une partie/)).toBeNull();
});

it('fenêtre partielle d’un jour : accordée au singulier, en français et en anglais', async () => {
  const note = () => text(document.querySelector('dl.grid')?.nextElementSibling);
  const above = world({ inflationBps: 420, status: 'above', partialWindow: 'previous' });
  await showAll([above], { priceWindowDays: 1 });
  const previous =
    "La fenêtre précédente ne couvre qu'une partie de son jour : l'historique des prix de ce monde commence à l'intérieur.";
  expect(note()).toBe(previous);
  expect(text(screen.getByRole('alert'))).toBe(
    `Alerte : inflation de +4,2 % sur 1 jour. Au-dessus de la cible (0 % à 3 %). ${previous}`,
  );
  await i18n.changeLanguage('en');
  const previousEn =
    "The previous window covers only part of its day: this world's price history starts inside it.";
  expect(note()).toBe(previousEn);
  expect(text(screen.getByRole('alert'))).toBe(
    `Alert: inflation of +4.2% over 1 day. Above target (0% to 3%). ${previousEn}`,
  );
  await i18n.changeLanguage('fr');
  const unknown = { previousBps: null, inflationBps: null, status: 'unknown' } as const;
  const current = world({ ...unknown, partialWindow: 'current' });
  await showAll([current], { priceWindowDays: 1 });
  expect(note()).toBe(
    "La fenêtre courante ne couvre qu'une partie de son jour : l'historique des prix de ce monde commence à l'intérieur.",
  );
  await i18n.changeLanguage('en');
  expect(note()).toBe(
    "The current window covers only part of its day: this world's price history starts inside it.",
  );
});

it('plusieurs mondes : alertes rappelées en tête de page, légendes propres à chaque monde', async () => {
  const id = (n: number) => `01900000-0000-7000-8000-00000000000${n}`;
  const worlds = [
    world(),
    { ...world({ inflationBps: 420, status: 'above' }), worldId: id(2), slug: 'delos' },
    { ...world({ inflationBps: -150, status: 'below' }), worldId: id(3), slug: 'naxos' },
  ];
  await showAll(worlds);
  const summary = screen.getByRole('region', { name: 'Inflation hors de la cible dans 2 mondes' });
  expect(within(summary).getAllByRole('listitem').map(text)).toEqual([
    'Monde « delos » : inflation de +4,2 %. Au-dessus de la cible (0 % à 3 %).',
    'Monde « naxos » : inflation de -1,5 %. Sous la cible (0 % à 3 %).',
  ]);
  // Chaque lien mène à la section de son monde, placée après le rappel.
  for (const link of within(summary).getAllByRole('link')) {
    const section = document.querySelector(link.getAttribute('href') ?? '');
    expect(section?.querySelector('h2')?.textContent).toBe(link.textContent);
    expect(summary.compareDocumentPosition(section as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  }
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  for (const slug of ['archipel', 'delos', 'naxos']) {
    expect(screen.getByRole('table', { name: `Masse monétaire, monde « ${slug} »` })).toBeTruthy();
  }
  await i18n.changeLanguage('en');
  expect(screen.getByRole('region', { name: 'Inflation off target in 2 worlds' })).toBeTruthy();
  expect(screen.getByRole('table', { name: 'Money supply, world “delos”' })).toBeTruthy();
  // Un seul monde : son alerte est déjà en tête, pas de rappel.
  await i18n.changeLanguage('fr');
  await showAll([worlds[1] as World]);
  expect(screen.queryByRole('region')).toBeNull();
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
