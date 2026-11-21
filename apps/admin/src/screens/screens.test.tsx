// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from '@supabase/supabase-js';
import { auth, resetAuth, VIGIE } from '../test/fakes';
import { Audit } from './Audit';
import { SecondFactor } from './SecondFactor';
import { Vigie } from './Vigie';

const adminGet = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ adminGet }));
vi.mock('../supabase', async () => ({ supabase: (await import('../test/fakes')).supabase }));

let i18n: Awaited<ReturnType<typeof initI18n>>;
beforeAll(async () => {
  i18n = await initI18n('fr');
});
beforeEach(() => {
  resetAuth();
  adminGet.mockReset();
});
afterEach(cleanup);

describe('second facteur', () => {
  it('un enrôlement abandonné est repris à neuf : ancien facteur retiré, nouvelle clé', async () => {
    auth.factors = [{ id: 'stale', status: 'unverified' }];
    render(<SecondFactor onVerified={() => undefined} />);
    expect(await screen.findByText('SECRET1')).toBeTruthy();
    expect(auth.unenrolled).toEqual(['stale']);
    expect(screen.getByRole('img', { name: "Code QR d'enrôlement" })).toBeTruthy();
  });

  it('un compte déjà enrôlé saisit son code, sans nouvelle clé ; les espaces sont retirés', async () => {
    auth.factors = [{ id: 'known', status: 'verified' }];
    const onVerified = vi.fn();
    render(<SecondFactor onVerified={onVerified} />);
    expect(
      await screen.findByText(
        "Entrez le code à six chiffres de votre application d'authentification.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(auth.enrolled).toBe(0);
    expect(auth.unenrolled).toEqual([]);
    fireEvent.change(screen.getByLabelText('Code à six chiffres'), {
      target: { value: ' 123 456 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(auth.codes).toEqual(['123456']);
  });

  it("un code refusé n'ouvre rien et le dit", async () => {
    auth.factors = [{ id: 'known', status: 'verified' }];
    auth.acceptCode = false;
    const onVerified = vi.fn();
    render(<SecondFactor onVerified={onVerified} />);
    await screen.findByText(/Entrez le code/);
    fireEvent.change(screen.getByLabelText('Code à six chiffres'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Code refusé'));
    expect(onVerified).not.toHaveBeenCalled();
  });
  // Erreurs telles que le client Supabase Auth les produit (`@supabase/auth-js`, `lib/fetch.ts`).
  it.each([
    [
      'sans réponse',
      new AuthRetryableFetchError('Failed to fetch', 0),
      'pas de réponse du service',
    ],
    ['503', new AuthRetryableFetchError('Service Unavailable', 503), 'indisponible pour le moment'],
    [
      'réponse illisible',
      new AuthUnknownError('Unexpected token', {}),
      'indisponible pour le moment',
    ],
    [
      '429',
      new AuthApiError('Too many requests', 429, 'over_request_rate_limit'),
      'Trop de tentatives',
    ],
    [
      'code faux',
      new AuthApiError('Invalid TOTP code', 422, 'mfa_verification_failed'),
      'Code refusé',
    ],
  ])('échec de vérification (%s) : message propre à sa cause', async (cause, codeError, text) => {
    const invalid = String(cause === 'code faux');
    auth.factors = [{ id: 'known', status: 'verified' }];
    Object.assign(auth, { acceptCode: false, codeError });
    render(<SecondFactor onVerified={() => undefined} />);
    await screen.findByText(/Entrez le code/);
    const input = screen.getByLabelText('Code à six chiffres');
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(text));
    // Seul un code refusé met la saisie en cause.
    expect(input.getAttribute('aria-invalid')).toBe(invalid);
  });

  it('une panne à la lecture des facteurs se relance par « Réessayer », sans recharger la page', async () => {
    auth.factors = [{ id: 'known', status: 'verified' }];
    auth.listError = { message: 'down' };
    render(<SecondFactor onVerified={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('indisponible'));
    auth.listError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText(/Entrez le code/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  });
});

describe('Vigie', () => {
  it('une lecture sans réponse le dit, et « Réessayer » la relance', async () => {
    adminGet.mockResolvedValueOnce({ ok: false, code: 'NETWORK' });
    adminGet.mockResolvedValue({ ok: true, data: VIGIE });
    render(<Vigie accessToken="token" />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      "L'API ne répond pas. Vérifiez votre connexion, puis réessayez.",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Maisons fondées')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(adminGet.mock.calls).toEqual([
      ['vigie', 'token'],
      ['vigie', 'token'],
    ]);
  });

  it('chaque compteur porte son intitulé, le tableau des ticks son nom et sa durée', async () => {
    adminGet.mockResolvedValue({ ok: true, data: VIGIE });
    render(<Vigie accessToken="token" />);
    const figure = async (label: string) =>
      (await screen.findByText(label)).parentElement?.querySelector('dd')?.textContent;
    expect(await figure('Commandes des joueurs réussies (24 h)')).toBe('300');
    expect(await figure('Commandes des joueurs refusées (24 h)')).toBe('41');
    expect(await figure('Commandes des joueurs en panne (24 h)')).toBe('7');
    expect(await figure('Opérations des intendants réussies (24 h)')).toBe('120');
    expect(await figure('Opérations des intendants refusées (24 h)')).toBe('9');
    expect(await figure('Opérations des intendants en panne (24 h)')).toBe('2');
    expect(await figure('Ticks en échec (24 h)')).toBe('2');
    expect(await figure('Tick le plus long (24 h)')).toBe('850 ms');
    expect(await figure("Voyages en retard de déchargement (plus d'un tick)")).toBe('4');
    expect(await figure('Clôtures en échec (24 h)')).toBe('1');
    expect(await figure('Dernier échec de clôture')).toBe(
      'Close step siteUpkeep failed on house h1: boom',
    );
    expect(await figure('Tâches en attente')).toBe('3');
    expect(await figure('Requêtes sans jeton valide (24 h)')).toBe('91');
    expect(await figure('Requêtes au-delà du débit (24 h)')).toBe('17');
    expect(await figure('Requêtes trop volumineuses (24 h)')).toBe('4');
    expect(await figure('Lectures du back-office refusées (24 h)')).toBe('6');
    expect(await figure('Lectures du back-office (24 h)')).toBe('58');
    expect(await figure('Double validation des paramètres')).toBe('Exigée');
    expect(screen.queryByText(/^Double validation levée/)).toBeNull();
    // Sans configuration en vigueur lisible, le compte des voyages est inconnu ; API antérieure : absent.
    for (const [voyagesOverdue, shown] of [
      [null, 'Inconnu (aucune configuration en vigueur lisible)'],
      [undefined, undefined],
    ] as const) {
      cleanup();
      adminGet.mockResolvedValue({ ok: true, data: { ...VIGIE, voyagesOverdue } });
      render(<Vigie accessToken="token" />);
      await screen.findByText('Maisons fondées');
      expect(
        screen
          .queryByText("Voyages en retard de déchargement (plus d'un tick)")
          ?.parentElement?.querySelector('dd')?.textContent,
      ).toBe(shown);
    }
    // Réglage d'un monde de test actif sur l'API : la Vigie le montre.
    cleanup();
    adminGet.mockResolvedValue({ ok: true, data: { ...VIGIE, selfReviewAllowed: true } });
    render(<Vigie accessToken="token" />);
    expect(await figure('Double validation des paramètres')).toBe('Levée (réglage de test)');
    expect(screen.getByText(/^Double validation levée/).textContent).toMatch(
      /une version de configuration peut être programmée par son auteur\.$/,
    );
    // API antérieure à ce champ, ou valeur qui n'est pas un booléen : état inconnu, jamais « Exigée ».
    for (const selfReviewAllowed of [undefined, null, 'true']) {
      cleanup();
      adminGet.mockResolvedValue({ ok: true, data: { ...VIGIE, selfReviewAllowed } });
      render(<Vigie accessToken="token" />);
      expect(await figure('Double validation des paramètres')).toBe(
        "Inconnue (non indiquée par l'API)",
      );
      expect(screen.queryByText(/^Double validation levée/)).toBeNull();
    }
    const table = screen.getByRole('table', { name: 'Dernières exécutions de tick' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['Heure', 'Monde', 'Tick', 'État', 'Durée', 'Erreur']);
    expect(within(table).getByText('120 ms')).toBeTruthy();
    expect(within(table).getByText('Joué')).toBeTruthy();
  });

  it('dit le fuseau en vigueur de tous les mondes, et alerte s’il est inconnu de la base, en fr et en en', async () => {
    const show = async (clock: unknown) => {
      cleanup();
      adminGet.mockResolvedValue({ ok: true, data: { ...VIGIE, clock } });
      render(<Vigie accessToken="token" />);
      await screen.findByText(i18n.t('vigie.houses'));
    };
    const figure = (label: string) =>
      screen.getByText(label).parentElement?.querySelector('dd')?.textContent;
    // Les alertes de la Vigie sont annoncées (`role="alert"`) : lues par leur rôle, dans l'ordre.
    const alerts = () => screen.queryAllByRole('alert').map((alert) => alert.textContent);
    const tile = 'Fuseau en vigueur (tous les mondes)';
    const unknownFr =
      'Fuseau en vigueur inconnu de la base : US/Pacific-New. Il vaut pour tous les mondes (1\u202f234) : ' +
      "les comptes des maisons n'y ont plus ni jour de jeu ni saison. Il faut rendre ce fuseau à " +
      'PostgreSQL, sur le serveur (spécification 03).';
    const invalidFr =
      "La configuration en vigueur ne respecte plus le schéma : l'API et le moteur ne peuvent pas la " +
      "charger. Son fuseau est lu tel qu'enregistré.";

    // Fuseau connu : nommé, sans alerte.
    await show(VIGIE.clock);
    expect(figure(tile)).toBe('Europe/Paris');
    expect(alerts()).toEqual([]);
    // Fuseau sorti de la base : la tuile le nomme, l'alerte dit sa portée et ce qu'il faut faire.
    const unknown = { timezone: 'US/Pacific-New', knownToDatabase: false, worlds: 1234 };
    await show(unknown);
    expect(figure(tile)).toBe('US/Pacific-New (inconnu de la base)');
    expect(alerts()).toEqual([unknownFr]);
    // Un nom long ne déborde pas de sa tuile ni de l'alerte.
    expect(screen.getByRole('alert').classList).toContain('wrap-anywhere');
    expect(screen.getByText(/\(inconnu de la base\)$/).classList).toContain('wrap-anywhere');
    // Aucun monde : jamais « tous les mondes (0) ».
    await show({ ...unknown, worlds: 0 });
    expect(alerts()).toEqual([
      "Fuseau en vigueur inconnu de la base : US/Pacific-New. Aucun monde n'existe encore, mais les " +
        "comptes des maisons de tout monde créé n'auraient ni jour de jeu ni saison. Il faut rendre ce " +
        'fuseau à PostgreSQL, sur le serveur (spécification 03).',
    ]);
    // Version en vigueur hors du schéma : dite telle, fuseau lu tel qu'enregistré, ou absent.
    await show({ ...unknown, invalidConfig: true });
    expect(alerts()).toEqual([invalidFr, unknownFr]);
    await show({ ...VIGIE.clock, invalidConfig: true });
    expect(figure(tile)).toBe('Europe/Paris');
    expect(alerts()).toEqual([invalidFr]);
    await show({ timezone: null, knownToDatabase: null, worlds: 2, invalidConfig: true });
    expect(figure(tile)).toBe('Absent de la configuration en vigueur');
    expect(alerts()).toEqual([invalidFr]);
    // Sans configuration en vigueur ; API antérieure au champ : rien à sa place.
    await show(null);
    expect(figure(tile)).toBe('Aucune configuration en vigueur');
    expect(alerts()).toEqual([]);
    await show(undefined);
    expect(screen.queryByText(tile)).toBeNull();

    await i18n.changeLanguage('en');
    try {
      const tileEn = 'Time zone in force (all worlds)';
      await show(VIGIE.clock);
      expect(figure(tileEn)).toBe('Europe/Paris');
      expect(alerts()).toEqual([]);
      await show(unknown);
      expect(figure(tileEn)).toBe('US/Pacific-New (unknown to the database)');
      expect(alerts()).toEqual([
        'Time zone in force unknown to the database: US/Pacific-New. It applies to every world ' +
          '(1,234): house accounts there no longer have a game day or season. This time zone must ' +
          'be given back to PostgreSQL, on the server (specification 03).',
      ]);
      await show({ ...unknown, worlds: 0 });
      expect(alerts()).toEqual([
        'Time zone in force unknown to the database: US/Pacific-New. No world exists yet, but house ' +
          'accounts in any world created would have no game day or season. This time zone must be ' +
          'given back to PostgreSQL, on the server (specification 03).',
      ]);
      await show({ timezone: null, knownToDatabase: null, worlds: 2, invalidConfig: true });
      expect(figure(tileEn)).toBe('Missing from the configuration in force');
      expect(alerts()).toEqual([
        'The configuration in force no longer matches the schema: the API and the engine cannot ' +
          'load it. Its time zone is read as stored.',
      ]);
      await show(null);
      expect(figure(tileEn)).toBe('No configuration in force');
    } finally {
      await i18n.changeLanguage('fr');
    }
  });

  it('le tableau des ticks se trie au clavier par sa durée, et le tri est annoncé', async () => {
    const tick = VIGIE.recentTicks[0] as (typeof VIGIE.recentTicks)[number];
    const recentTicks = [
      tick,
      { ...tick, tickIndex: 10, durationMs: 900, createdAt: '2026-11-13T11:00:00Z' },
      { ...tick, tickIndex: 11, durationMs: 40, createdAt: '2026-11-13T12:00:00Z' },
    ];
    adminGet.mockResolvedValue({ ok: true, data: { ...VIGIE, recentTicks } });
    render(<Vigie accessToken="token" />);
    const table = await screen.findByRole('table', { name: 'Dernières exécutions de tick' });
    const ticks = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.children[2]?.textContent);
    expect(ticks()).toEqual(['9', '10', '11']);
    fireEvent.click(within(table).getByRole('button', { name: 'Durée' }));
    expect(ticks()).toEqual(['10', '9', '11']);
    expect(screen.getByRole('status').textContent).toBe('Trié par Durée, décroissant');
  });

  it("le tableau des ticks nomme le monde, l'identifiant ne venant qu'à défaut ; dates en toutes lettres", async () => {
    const tick = VIGIE.recentTicks[0] as (typeof VIGIE.recentTicks)[number];
    const unnamed = { ...tick, worldSlug: undefined };
    adminGet.mockResolvedValue({
      ok: true,
      data: { ...VIGIE, recentTicks: [tick, { ...unnamed, tickIndex: 10 }] },
    });
    render(<Vigie accessToken="token" />);
    const table = await screen.findByRole('table', { name: 'Dernières exécutions de tick' });
    const cells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [row.children[0]?.textContent, row.children[1]?.textContent]);
    expect(cells).toEqual([
      [expect.stringMatching(/^13 nov\. 2026/), 'archipel'],
      [expect.stringMatching(/^13 nov\. 2026/), '01900000'],
    ]);
  });

  it("les cartes de refus et d'échecs portent leur état, dit par une icône et la teinte", async () => {
    adminGet.mockResolvedValue({ ok: true, data: VIGIE });
    render(<Vigie accessToken="token" />);
    const card = async (label: string) =>
      (await screen.findByText(label)).closest('[data-stat-card]') as HTMLElement;
    // Non nul : danger pour une panne, alerte pour un refus ; nul : succès.
    expect(
      (await card('Commandes des joueurs en panne (24 h)')).querySelector('.text-danger'),
    ).toBeTruthy();
    expect(
      (await card('Commandes des joueurs refusées (24 h)')).querySelector('.text-warning'),
    ).toBeTruthy();
    expect((await card('Maisons fondées')).querySelector('svg')).toBeNull();
    adminGet.mockResolvedValue({
      ok: true,
      data: { ...VIGIE, commands24h: { ok: 1, rejected: 0, failed: 0 } },
    });
    cleanup();
    render(<Vigie accessToken="token" />);
    expect(
      (await card('Commandes des joueurs en panne (24 h)')).querySelector('.text-success'),
    ).toBeTruthy();
  });

  it("un refus de l'API est affiché, sans compteur", async () => {
    adminGet.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    render(<Vigie accessToken="token" />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Votre rôle ne donne pas accès à ce module.',
    );
    expect(screen.queryByText('Maisons fondées')).toBeNull();
    // Un refus de rôle est définitif : rien à relancer.
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  });
});

describe('Vigie : maisons PNJ de secours non fondées (8.3, #949)', () => {
  const answer = (npcHousesSkipped: unknown) =>
    adminGet.mockResolvedValue({ ok: true, data: { ...VIGIE, npcHousesSkipped } });

  it('alerte et nomme chaque filière passée, nom pris ou refusé par la base', async () => {
    answer([
      {
        worldSlug: 'archipel',
        citySlug: 'kalliste',
        chainId: 'bread',
        name: 'Greniers',
        reason: 'taken',
      },
      {
        worldSlug: 'archipel',
        citySlug: null,
        chainId: 'wine',
        name: 'Pressoirs 2',
        reason: 'refused',
      },
    ]);
    render(<Vigie accessToken="token" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Maisons PNJ de secours non fondées à la dernière clôture');
    expect([...alert.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'archipel · kalliste · filière bread : le nom « Greniers » est déjà porté dans le monde.',
      'archipel · — · filière wine : la base refuse le nom « Pressoirs 2 ».',
    ]);
  });

  it('aucune filière passée, ou API antérieure : pas d’alerte', async () => {
    answer([]);
    const first = render(<Vigie accessToken="token" />);
    await screen.findByText('Maisons fondées');
    expect(screen.queryByRole('alert')).toBeNull();
    first.unmount();
    answer(undefined);
    render(<Vigie accessToken="token" />);
    await screen.findByText('Maisons fondées');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Vigie : signalements en attente (15.5)', () => {
  const figure = async (label: string) =>
    (await screen.findByText(label)).parentElement?.querySelector('dd')?.textContent;
  const answer = (staleReports: unknown) =>
    adminGet.mockResolvedValue({ ok: true, data: { ...VIGIE, staleReports } });

  it('affiche le compte et passe en alerte quand des signalements dépassent le seuil de la configuration', async () => {
    answer({ afterHours: 12, count: 3, oldestHours: 27 });
    render(<Vigie accessToken="token" />);
    expect(
      await screen.findByText(
        'Des signalements attendent depuis plus de 12 h (le plus ancien : 27 h).',
      ),
    ).toBeTruthy();
    expect(await figure('Signalements en attente depuis plus de 12 h')).toBe('3');
    expect(adminGet.mock.calls.map(([path]) => path)).toEqual(['vigie']);
  });

  it('aucun signalement au-delà du seuil : le compte à zéro, pas d’alerte', async () => {
    answer({ afterHours: 24, count: 0, oldestHours: null });
    render(<Vigie accessToken="token" />);
    expect(await figure('Signalements en attente depuis plus de 24 h')).toBe('0');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('seuil illisible : dit qu’il est inconnu, sans alerte ; API antérieure : rien', async () => {
    answer(null);
    const first = render(<Vigie accessToken="token" />);
    expect(await figure('Signalements en attente (seuil inconnu)')).toBe('—');
    expect(screen.queryByRole('alert')).toBeNull();
    first.unmount();
    answer(undefined);
    render(<Vigie accessToken="token" />);
    await screen.findByText('Maisons fondées');
    expect(screen.queryByText(/Signalements en attente/)).toBeNull();
  });
});

describe('Vigie : passerelle IA', () => {
  const AI = [
    {
      usage: 'oracle',
      cut: 'disabled',
      capMicroEuros: 0,
      spentTodayMicroEuros: 0,
      spentMonthMicroEuros: 0,
      answeredMonth: 0,
      rejectedMonth: 0,
    },
    {
      usage: 'chronicle',
      cut: null,
      capMicroEuros: 2_000_000,
      spentTodayMicroEuros: 1_250,
      spentMonthMicroEuros: 432_100,
      answeredMonth: 40,
      rejectedMonth: 3,
    },
    {
      usage: 'steward',
      cut: 'capped',
      capMicroEuros: 500_000,
      spentTodayMicroEuros: 0,
      spentMonthMicroEuros: 499_900,
      answeredMonth: 12,
      rejectedMonth: 0,
    },
  ];

  it('une ligne par usage : état, coût du jour, coût du mois sur le plafond, sorties rejetées', async () => {
    adminGet.mockResolvedValue({ ok: true, data: { ...VIGIE, ai: AI } });
    render(<Vigie accessToken="token" />);
    const table = await screen.findByRole('table', { name: 'Passerelle IA (estimation)' });
    const rows = within(table)
      .getAllByRole('row')
      .map((row) =>
        Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent?.replace(/\s/g, ' ')),
      );
    expect(rows).toEqual([
      ['Usage', 'État', 'Coût du jour (UTC)', 'Coût du mois / plafond', 'Sorties rejetées (mois)'],
      ['Oracles de la Pythie', 'Coupé (configuration)', '0,00 €', '0,00 € sur 0,00 €', '0 sur 0'],
      ['Chronique des cités', 'Ouvert', '0,0013 €', '0,4321 € sur 2,00 €', '3 sur 40'],
      [
        'Consignes d’intendant'.replace('’', "'"),
        'Coupé (plafond du mois atteint ou trop proche)',
        '0,00 €',
        '0,4999 € sur 0,50 €',
        '0 sur 12',
      ],
    ]);
  });

  it('sans configuration lisible, ou avec une API antérieure, pas de tableau', async () => {
    for (const ai of [null, undefined]) {
      cleanup();
      adminGet.mockResolvedValue({ ok: true, data: { ...VIGIE, ai } });
      render(<Vigie accessToken="token" />);
      expect(await screen.findByText('Maisons fondées')).toBeTruthy();
      expect(screen.queryByRole('table', { name: 'Passerelle IA (estimation)' })).toBeNull();
    }
  });
});

describe("journal d'audit", () => {
  const entry = (index: number, extra: object = {}) => ({
    id: `id-${String(index).padStart(3, '0')}`,
    userId: '00000000-0000-4000-8000-00000000000a',
    command: `admin.command${index}`,
    status: 'ok',
    errorCode: null,
    result: null,
    createdAt: '2026-11-13T10:00:00Z',
    ...extra,
  });
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, offset) => entry(from + offset));
  const commands = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[2]?.textContent);

  it('les pages plus anciennes s’ajoutent à la suite, sans doublon ni perte', async () => {
    adminGet.mockImplementation((path: string) =>
      Promise.resolve({
        ok: true,
        data: { entries: path.includes('before=id-050') ? range(51, 60) : range(1, 50) },
      }),
    );
    render(<Audit accessToken="token" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrées plus anciennes' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(61));
    expect(adminGet).toHaveBeenLastCalledWith('audit?limit=50&before=id-050', 'token');
    expect(commands()).toEqual(range(1, 60).map((item) => item.command));
    // Dernière page incomplète : plus rien à charger.
    expect(screen.queryByRole('button', { name: 'Entrées plus anciennes' })).toBeNull();
    expect(screen.getByRole('table', { name: /Commandes d'administration/ })).toBeTruthy();
  });

  it('le journal se filtre par issue, parmi les entrées lues', async () => {
    const entries = [entry(1), entry(2, { status: 'rejected', errorCode: 'X' }), entry(3)];
    adminGet.mockResolvedValue({ ok: true, data: { entries } });
    render(<Audit accessToken="token" />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('radio', { name: 'Refusées' }));
    expect(commands()).toEqual(['admin.command2']);
    expect(
      screen.getByText(
        '1 sur 3 entrées lues : le filtre ne porte que sur les entrées déjà chargées.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'En panne' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(
      screen.getByRole('heading', { name: "Aucune entrée chargée n'a cette issue." }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Toutes' }));
    expect(commands()).toHaveLength(3);
  });

  it('aucune entrée de cette issue : l’état vide ramène à tout le journal (#866)', async () => {
    adminGet.mockResolvedValue({ ok: true, data: { entries: [entry(1), entry(2)] } });
    render(<Audit accessToken="token" />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('radio', { name: 'En panne' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voir toutes les entrées' }));
    expect(commands()).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it("chaque issue a son libellé, avec le code d'un refus", async () => {
    adminGet.mockResolvedValue({
      ok: true,
      data: {
        entries: [
          entry(1),
          entry(2, { status: 'rejected', errorCode: 'CONFIG_INVALID' }),
          entry(3, { status: 'failed' }),
          entry(4, { status: 'rejected' }),
        ],
      },
    });
    render(<Audit accessToken="token" />);
    await screen.findByRole('table');
    const outcomes = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[3]?.textContent);
    expect(outcomes).toEqual(['Réussie', 'Refusée (CONFIG_INVALID)', 'En panne', 'Refusée']);
  });

  it.each([
    ['NETWORK', "L'API ne répond pas. Vérifiez votre connexion, puis réessayez."],
    ['RATE_LIMITED', 'Trop de demandes en peu de temps. Patientez un instant, puis réessayez.'],
    ['INTERNAL', 'Lecture impossible pour le moment.'],
  ])('une lecture en échec (%s) a son message et se relance', async (code, message) => {
    adminGet.mockResolvedValueOnce({ ok: false, code });
    adminGet.mockResolvedValue({ ok: true, data: { entries: range(1, 3) } });
    render(<Audit accessToken="token" />);
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('une page plus ancienne en échec laisse les pages lues à l’écran et se redemande telle quelle', async () => {
    let down = true;
    adminGet.mockImplementation((path: string) => {
      if (!path.includes('before='))
        return Promise.resolve({ ok: true, data: { entries: range(1, 50) } });
      if (down) return Promise.resolve({ ok: false, code: 'NETWORK' });
      return Promise.resolve({ ok: true, data: { entries: range(51, 60) } });
    });
    render(<Audit accessToken="token" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrées plus anciennes' }));
    expect((await screen.findByRole('alert')).textContent).toContain("L'API ne répond pas");
    expect(screen.getAllByRole('row')).toHaveLength(51);
    down = false;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(61));
    expect(adminGet.mock.calls.map(([path]) => path as string)).toEqual([
      'audit?limit=50',
      'audit?limit=50&before=id-050',
      'audit?limit=50&before=id-050',
    ]);
    expect(commands()).toEqual(range(1, 60).map((item) => item.command));
  });

  it('un double clic ne lit la page qu’une fois : aucune entrée en double', async () => {
    let failing = true;
    adminGet.mockImplementation((path: string) => {
      if (!path.includes('before='))
        return Promise.resolve({ ok: true, data: { entries: range(1, 50) } });
      const reply = failing
        ? { ok: false, code: 'NETWORK' }
        : { ok: true, data: { entries: range(51, 60) } };
      return new Promise((resolve) => setTimeout(() => resolve(reply), 10));
    });
    render(<Audit accessToken="token" />);
    const older = await screen.findByRole('button', { name: 'Entrées plus anciennes' });
    fireEvent.click(older);
    fireEvent.click(older);
    const retry = await screen.findByRole('button', { name: 'Réessayer' });
    expect(adminGet).toHaveBeenCalledTimes(2);
    failing = false;
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(61));
    expect(adminGet).toHaveBeenCalledTimes(3);
    expect(commands()).toEqual(range(1, 60).map((item) => item.command));
    // « Réessayer » a disparu : le foyer est posé sur le titre, pas perdu.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('au renouvellement du jeton, les pages lues restent ; la suivante part avec le nouveau jeton', async () => {
    adminGet.mockImplementation((path: string) =>
      Promise.resolve({
        ok: true,
        data: { entries: path.includes('before=id-050') ? range(51, 100) : range(1, 50) },
      }),
    );
    const { rerender } = render(<Audit accessToken="jeton-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entrées plus anciennes' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(101));
    rerender(<Audit accessToken="jeton-2" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Rien n'est relu : la page affichée et sa position sont intactes.
    expect(adminGet).toHaveBeenCalledTimes(2);
    expect(commands()).toEqual(range(1, 100).map((item) => item.command));
    fireEvent.click(screen.getByRole('button', { name: 'Entrées plus anciennes' }));
    await waitFor(() => expect(adminGet).toHaveBeenCalledTimes(3));
    expect(adminGet).toHaveBeenLastCalledWith('audit?limit=50&before=id-100', 'jeton-2');
  });
});
