// @vitest-environment jsdom
import { adminReportsSchema, type AdminReports } from '@oikos/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { held } from '../test/fakes';
import { Moderation } from './Moderation';

const api = vi.hoisted(() => ({ adminGet: vi.fn(), adminCommand: vi.fn() }));
vi.mock('../api', () => api);
const { adminGet, adminCommand } = api;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-11-18T12:00:00Z';
const message = (
  n: number,
  houseName: string,
  body: string,
  createdAt: string,
  hiddenAt = null,
) => ({
  id: id(n),
  houseId: id(900 + n),
  houseName,
  body,
  createdAt,
  hiddenAt,
});
/** Forme rendue par `GET /api/admin/reports` (contrat strict : le test la valide). */
const REPORTS: AdminReports = {
  now: NOW,
  contextSize: 2,
  staleAfterHours: 24,
  sanctionHours: { warning: [168], silence: [1, 24, 72], suspension: [24, 168, 720] },
  queue: [
    {
      world: 'w',
      reportedHouse: { id: id(801), name: 'Alpha', userId: id(701) },
      channel: { id: id(601), kind: 'city', city: 'athens' },
      message: message(1, 'Alpha', 'Tu es nul', '2026-11-17T09:00:00Z'),
      reports: [
        { id: id(501), reason: 'harassment', createdAt: '2026-11-17T10:00:00Z' },
        { id: id(502), reason: 'spam', createdAt: '2026-11-17T11:00:00Z' },
      ],
      context: [
        message(2, 'Beta', 'Bonjour à tous', '2026-11-17T08:55:00Z'),
        message(3, 'Gamma', 'Calmez-vous', '2026-11-17T09:05:00Z'),
      ],
    },
    {
      world: 'w',
      reportedHouse: { id: id(802), name: 'Delta', userId: id(702) },
      channel: null,
      message: null,
      reports: [{ id: id(503), reason: 'cheating', createdAt: '2026-11-18T11:00:00Z' }],
      context: [],
    },
  ],
  appeals: [],
  pendingExclusions: [],
  pendingLifts: [],
  activeExclusions: [],
};
const [FIRST, SECOND] = REPORTS.queue as [
  AdminReports['queue'][number],
  AdminReports['queue'][number],
];
const AFTER: AdminReports = { ...REPORTS, queue: REPORTS.queue.slice(1) };

let i18n: Awaited<ReturnType<typeof initI18n>>;
beforeAll(async () => {
  i18n = await initI18n('fr');
});
beforeEach(() => {
  adminGet.mockReset();
  adminCommand.mockReset();
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('fr');
});

/** File lue, puis relue après chaque commande : `after` (par défaut sans la première entrée, traitée). */
async function opened(commandReplies: object[] = [], after: AdminReports = AFTER) {
  adminGet.mockResolvedValueOnce({ ok: true, data: REPORTS });
  adminGet.mockResolvedValue({ ok: true, data: after });
  for (const reply of commandReplies) adminCommand.mockResolvedValueOnce(reply);
  render(<Moderation accessToken="token" />);
  await screen.findByRole('heading', { name: 'Signalements à traiter' });
}
const entryOf = (house: string) =>
  screen.getByRole('listitem', { name: new RegExp(`^Message de la maison ${house} :`) });
const findEntry = (house: string) =>
  screen.findByRole('listitem', { name: new RegExp(`^Message de la maison ${house} :`) });
/** Geste d'une entrée : l'action principale, ou un geste du menu « Autres gestes », ouvert au besoin. */
function gesture(house: string, name: string) {
  const entry = within(entryOf(house));
  const shown = entry.queryByRole('button', { name }) ?? entry.queryByRole('menuitem', { name });
  if (shown) return shown;
  fireEvent.click(entry.getByRole('button', { name: 'Autres gestes' }));
  return entry.getByRole('menuitem', { name });
}
const notice = (role: 'status' | 'alert') =>
  screen.getAllByRole(role).find((node) => node.tagName === 'DIV')?.textContent;
const enter = (repeat = false) => {
  const target = document.activeElement as HTMLElement;
  if (fireEvent.keyDown(target, { key: 'Enter', repeat })) fireEvent.click(target);
};

it('la fixture est celle du contrat strict', () => {
  expect(adminReportsSchema.safeParse(REPORTS).success).toBe(true);
});

it('montre le pré-tri de l’IA : catégorie, résumé et sa source ; rien sans pré-tri ; aucun geste ne change (#763)', async () => {
  const triaged: AdminReports = {
    ...REPORTS,
    queue: [
      {
        ...FIRST,
        triage: { category: 'likely_unfounded', summary: 'Plaisanterie entre voisins.' },
      },
      SECOND,
    ],
  };
  expect(adminReportsSchema.safeParse(triaged).success).toBe(true);
  adminGet.mockResolvedValue({ ok: true, data: triaged });
  render(<Moderation accessToken="token" />);
  await screen.findByRole('heading', { name: 'Signalements à traiter' });
  const alpha = within(entryOf('Alpha'));
  const triage = within(alpha.getByRole('region', { name: 'Pré-tri par l’IA' }));
  expect(triage.getByText('Probablement infondé')).toBeTruthy();
  expect(triage.getByText('Plaisanterie entre voisins.')).toBeTruthy();
  expect(
    triage.getByText('Généré par l’IA, peut se tromper : la décision reste la vôtre.'),
  ).toBeTruthy();
  expect(screen.getByText(/violations probables d’après l’IA viennent en premier/)).toBeTruthy();
  // Une entrée sans pré-tri n'a pas de bloc.
  expect(within(entryOf('Delta')).queryByRole('region', { name: 'Pré-tri par l’IA' })).toBeNull();
  // Même « probablement infondé », l'écran propose les mêmes gestes, le masquage en premier : rien n'est décidé ni caché.
  const names = (house: string) =>
    within(entryOf(house))
      .getAllByRole('button')
      .map((button) => button.textContent);
  expect(names('Alpha')).toContain('Masquer le message');
  expect(gesture('Alpha', 'Avertir')).toBeTruthy();
  expect(gesture('Alpha', 'Suspendre')).toBeTruthy();
});

it('IA coupée, sans pré-tri : ni bloc, ni phrase sur l’ordre, la file garde celui de l’API (#763)', async () => {
  await opened();
  expect(screen.queryByRole('region', { name: 'Pré-tri par l’IA' })).toBeNull();
  expect(screen.queryByText(/d’après l’IA/)).toBeNull();
});

it('en anglais, le pré-tri est complet : catégories, source et ordre (#763)', async () => {
  await i18n.changeLanguage('en');
  adminGet.mockResolvedValue({
    ok: true,
    data: {
      ...REPORTS,
      queue: [
        { ...FIRST, triage: { category: 'likely_violation', summary: 'Insult.' } },
        { ...SECOND, triage: { category: 'doubtful', summary: 'Ambiguous.' } },
      ],
    },
  });
  render(<Moderation accessToken="token" />);
  await screen.findByRole('heading', { name: 'Reports to handle' });
  expect(screen.getByText('Probable violation')).toBeTruthy();
  expect(screen.getByText('Doubtful')).toBeTruthy();
  expect(screen.getAllByText(/Generated by the AI, it may be wrong/)).toHaveLength(2);
  expect(screen.getByText(/Probable violations according to the AI come first/)).toBeTruthy();
});

it('liste la file dans l’ordre de l’API, avec motifs, ancienneté et conversation autour du message', async () => {
  await opened();
  expect(adminGet.mock.calls).toEqual([['reports', 'token']]);
  expect(screen.getByText('2 messages signalés, du plus ancien au plus signalé')).toBeTruthy();
  const entries = screen.getAllByRole('listitem', { name: /^Message de la maison/ });
  expect(entries.map((entry) => entry.querySelector('h3')?.textContent)).toEqual([
    'Message de la maison Alpha : 2 signalements',
    'Message de la maison Delta : 1 signalement',
  ]);
  const alpha = within(entryOf('Alpha'));
  // Ancienneté du plus ancien signalement (26 h) ; motifs traduits ; canal.
  expect(
    alpha.getByText(/Signalé depuis le 17\/11\/2026.*\(26 h\) · canal de la cité athens/),
  ).toBeTruthy();
  expect(alpha.getByText(/Harcèlement/)).toBeTruthy();
  expect(alpha.getByText(/Pourriel/)).toBeTruthy();
  // Le message signalé est remis à sa place, entre ses voisins, et marqué.
  const lines = within(alpha.getByRole('list', { name: 'Conversation autour du message signalé' }))
    .getAllByRole('listitem')
    .map((line) => line.textContent);
  expect(
    lines.map((line) => /(Bonjour à tous|Tu es nul|Calmez-vous)/.exec(line ?? '')?.[1]),
  ).toEqual(['Bonjour à tous', 'Tu es nul', 'Calmez-vous']);
  expect(lines[1]).toContain('(signalé)');
  // Message purgé : le signalement reste, sans texte.
  expect(
    within(entryOf('Delta')).getByText(
      'Message purgé : le signalement reste, sans texte ni contexte.',
    ),
  ).toBeTruthy();
  expect(within(entryOf('Delta')).queryByRole('button', { name: 'Masquer le message' })).toBeNull();
});

it('une action principale par entrée, les autres gestes au menu ; motifs en pastilles, canal traduit', async () => {
  const kalliste = {
    ...REPORTS,
    queue: REPORTS.queue.map((entry, n) =>
      n === 0
        ? { ...entry, channel: { id: id(601), kind: 'city' as const, city: 'kalliste' } }
        : entry,
    ),
  };
  adminGet.mockResolvedValue({ ok: true, data: kalliste });
  render(<Moderation accessToken="token" />);
  const alpha = within(await findEntry('Alpha'));
  expect(alpha.getByText(/· canal de la cité Kallistè$/)).toBeTruthy();
  // Les motifs : une liste nommée, sans puces natives.
  const reasons = alpha.getByRole('list', { name: 'Motifs des signalements' });
  expect(reasons.className).not.toContain('list-disc');
  expect(
    within(reasons)
      .getAllByRole('listitem')
      .map((node) => node.textContent),
  ).toEqual([expect.stringMatching(/^Harcèlement \(/), expect.stringMatching(/^Pourriel \(/)]);
  // Message lisible : « Masquer » en action principale, seule à côté du menu ; chaque geste a son icône.
  const group = within(alpha.getByRole('group', { name: 'Actions sur la maison Alpha' }));
  expect(group.getAllByRole('button').map((node) => node.textContent)).toEqual([
    'Masquer le message',
    'Autres gestes',
  ]);
  fireEvent.click(group.getByRole('button', { name: 'Autres gestes' }));
  expect(group.getAllByRole('menuitem').map((node) => node.textContent)).toEqual([
    'Avertir',
    'Réduire au silence',
    'Suspendre',
    "Proposer l'exclusion",
    'Retenir le signalement',
    'Classer sans suite',
  ]);
  for (const node of [group.getByRole('button', { name: 'Masquer le message' })].concat(
    group.getAllByRole('menuitem'),
  ))
    expect(node.querySelector('svg')?.closest('[aria-hidden="true"]')).toBeTruthy();
  // Message purgé : « Retenir » devient l'action principale, et le menu n'a rien à masquer.
  const delta = within(entryOf('Delta'));
  fireEvent.click(delta.getByRole('button', { name: 'Autres gestes' }));
  expect(delta.getByRole('button', { name: 'Retenir le signalement' })).toBeTruthy();
  expect(delta.getAllByRole('menuitem').map((node) => node.textContent)).toEqual([
    'Avertir',
    'Réduire au silence',
    'Suspendre',
    "Proposer l'exclusion",
    'Classer sans suite',
  ]);
  await i18n.changeLanguage('en');
  expect(alpha.getByText(/· channel of the city Kallistè$/)).toBeTruthy();
  expect(alpha.getByRole('button', { name: 'More actions' })).toBeTruthy();
});

it('menu des gestes au clavier : ↓ l’ouvre, les flèches le parcourent, Entrée ouvre la feuille, Échap y ramène', async () => {
  await opened();
  const alpha = within(entryOf('Alpha'));
  const more = alpha.getByRole('button', { name: 'Autres gestes' });
  more.focus();
  fireEvent.keyDown(more, { key: 'ArrowDown' });
  const item = (name: string) => alpha.getByRole('menuitem', { name });
  expect(document.activeElement).toBe(item('Avertir'));
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(item('Classer sans suite'));
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(item('Réduire au silence'));
  // Échap referme le menu et rend le foyer au bouton.
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
  expect(alpha.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(more);
  // Entrée sur un geste : la feuille du geste s'ouvre, foyer sur sa première durée.
  fireEvent.keyDown(more, { key: 'ArrowDown' });
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
  enter();
  const sheet = screen.getByRole('dialog', { name: 'Réduire au silence' });
  expect(document.activeElement).toBe(radio('1 heure'));
  // Échap dans la feuille : elle se referme, le menu se rouvre sur le geste.
  fireEvent.keyDown(sheet, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(item('Réduire au silence'));
  // Entrée tenue sur un geste du menu n'ouvre rien.
  enter(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(adminCommand).not.toHaveBeenCalled();
});

it('une file vide le dit ; l’anglais est complet', async () => {
  adminGet.mockResolvedValue({ ok: true, data: { ...REPORTS, queue: [] } });
  render(<Moderation accessToken="token" />);
  expect(await screen.findByText('Aucun signalement en attente.')).toBeTruthy();
  await i18n.changeLanguage('en');
  expect(screen.getByText('No report is waiting.')).toBeTruthy();
});

it('alerte quand le plus ancien signalement attend depuis plus de 24 h, pas avant', async () => {
  await opened();
  expect(screen.getByRole('alert').textContent).toBe(
    'Des signalements attendent depuis plus de 24 h (le plus ancien : 26 h).',
  );
  cleanup();
  adminGet.mockResolvedValue({ ok: true, data: { ...REPORTS, queue: REPORTS.queue.slice(1) } });
  render(<Moderation accessToken="token" />);
  await screen.findByRole('heading', { name: 'Signalements à traiter' });
  expect(screen.queryByText(/attendent depuis plus de 24 h/)).toBeNull();
});

it('une lecture en échec le dit et se relance', async () => {
  adminGet.mockResolvedValueOnce({ ok: false, code: 'NETWORK' });
  adminGet.mockResolvedValue({ ok: true, data: REPORTS });
  render(<Moderation accessToken="token" />);
  expect((await screen.findByRole('alert')).textContent).toContain("L'API ne répond pas");
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await screen.findByRole('heading', { name: 'Signalements à traiter' });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })),
  );
});

it('masque un message après confirmation qui nomme la maison ; annuler ne fait rien', async () => {
  await opened([{ ok: true, data: { messageId: id(1), hiddenAt: NOW } }]);
  const hide = () => gesture('Alpha', 'Masquer le message');
  fireEvent.click(hide());
  const cancel = screen.getByRole('button', { name: 'Annuler' });
  expect(document.activeElement).toBe(cancel);
  expect(document.getElementById(cancel.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
    'Le message de la maison Alpha sera masqué pour les joueurs ; la modération le lira encore.',
  );
  fireEvent.click(cancel);
  expect(adminCommand).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(hide());
  fireEvent.click(hide());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le masquage' }));
  await waitFor(() => expect(notice('status')).toBe('Message masqué.'));
  expect(adminCommand).toHaveBeenCalledTimes(1);
  expect(adminCommand.mock.calls[0]?.slice(0, 3)).toEqual([
    'admin.hideMessage',
    { messageId: id(1) },
    'token',
  ]);
  // File relue : l'entrée traitée n'y est plus ; le foyer va au titre.
  expect(screen.queryByRole('listitem', { name: /Alpha/ })).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })),
  );
});

it('chaque geste de la file s’ouvre dans une feuille nommée, qui rappelle l’entrée et le message', async () => {
  await opened();
  fireEvent.click(gesture('Alpha', 'Suspendre'));
  const sheet = screen.getByRole('dialog', { name: 'Suspendre' });
  expect(within(sheet).getByText('Message de la maison Alpha : 2 signalements')).toBeTruthy();
  expect(within(sheet).getByText('Tu es nul')).toBeTruthy();
  expect(within(sheet).getByLabelText('Motif')).toBeTruthy();
  // Échap vaut « Annuler » : rien n'est envoyé, le foyer revient au bouton du geste.
  fireEvent.keyDown(sheet, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(
    within(entryOf('Alpha')).getByRole('menuitem', { name: 'Suspendre' }),
  );
  // Un geste sans champ n'en montre aucun.
  fireEvent.click(gesture('Alpha', 'Masquer le message'));
  expect(within(screen.getByRole('dialog')).queryByLabelText('Motif')).toBeNull();
  expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'Durée' })).toBeNull();
  expect(adminCommand).not.toHaveBeenCalled();
});

it('la file se filtre par maison, et le compte affiché le dit', async () => {
  await opened();
  fireEvent.change(screen.getByLabelText('Filtrer par maison'), { target: { value: 'del' } });
  const entries = screen.getAllByRole('listitem', { name: /^Message de la maison/ });
  expect(entries).toEqual([entryOf('Delta')]);
  expect(screen.getByText(/^2 messages signalés.* 1 affiché\.$/)).toBeTruthy();
});

it('Entrée tenue ou redoublée sur un geste n’envoie rien ; seul un appui franc sur « Confirmer » agit', async () => {
  await opened([{ ok: true, data: { messageId: id(1), hiddenAt: NOW } }]);
  gesture('Alpha', 'Masquer le message').focus();
  enter();
  for (let n = 0; n < 3; n += 1) enter(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' }));
  expect(adminCommand).not.toHaveBeenCalled();
  const confirm = screen.getByRole('button', { name: 'Confirmer le masquage' });
  confirm.focus();
  enter(true);
  expect(adminCommand).not.toHaveBeenCalled();
  enter();
  await waitFor(() => expect(adminCommand).toHaveBeenCalledTimes(1));
});

it('classe sans suite et retient : la commande désigne le premier signalement de l’entrée', async () => {
  await opened([{ ok: true, data: { reportIds: [id(501), id(502)], decision: 'dismissed' } }]);
  fireEvent.click(gesture('Alpha', 'Classer sans suite'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : classer sans suite' }));
  await waitFor(() => expect(notice('status')).toBe('Signalements classés sans suite.'));
  expect(adminCommand.mock.calls[0]?.slice(0, 2)).toEqual([
    'admin.resolveReport',
    { reportId: id(501), decision: 'dismissed' },
  ]);
  fireEvent.click(gesture('Delta', 'Retenir le signalement'));
  adminCommand.mockResolvedValueOnce({
    ok: true,
    data: { reportIds: [id(503)], decision: 'upheld' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : retenir' }));
  await waitFor(() => expect(adminCommand).toHaveBeenCalledTimes(2));
  expect(adminCommand.mock.calls[1]?.[1]).toEqual({ reportId: id(503), decision: 'upheld' });
});

it('un refus de l’API est expliqué et le foyer revient au bouton du geste', async () => {
  await opened([{ ok: false, code: 'SECOND_PERSON_REQUIRED' }], REPORTS);
  fireEvent.click(gesture('Alpha', 'Classer sans suite'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : classer sans suite' }));
  await waitFor(() =>
    expect(notice('alert')).toBe(
      "Un autre compte que l'auteur et que le compte concerné doit le faire.",
    ),
  );
  // Le bouton du geste, dans l'entrée qui l'a porté, reprend le foyer. Il le reprend par un effet passif, après la
  // fermeture de la feuille : l'avis peut paraître un instant avant.
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(entryOf('Alpha')).getByRole('menuitem', { name: 'Classer sans suite' }),
    ),
  );
});

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;

it('réduit au silence : une durée proposée et un motif, puis commande avec la durée choisie', async () => {
  await opened([
    {
      ok: true,
      data: { sanctionId: id(301), kind: 'silence', startsAt: NOW, endsAt: NOW, pending: false },
    },
  ]);
  fireEvent.click(gesture('Alpha', 'Réduire au silence'));
  // Les durées de la configuration en vigueur, rendues par l'API ; aucun champ libre.
  const group = screen.getByRole('group', { name: 'Durée' });
  expect(
    within(group)
      .getAllByRole('radio')
      .map((node) => node.getAttribute('value')),
  ).toEqual(['1', '24', '72']);
  expect(within(group).queryByRole('spinbutton')).toBeNull();
  expect(radio('1 heure').checked).toBe(false);
  expect(document.activeElement).toBe(radio('1 heure'));
  const confirm = () => screen.getByRole('button', { name: 'Confirmer le silence' });
  fireEvent.click(confirm());
  expect(adminCommand).not.toHaveBeenCalled();
  expect(screen.getByText("Choisissez l'une des durées proposées.")).toBeTruthy();
  expect(document.activeElement).toBe(radio('1 heure'));
  fireEvent.click(radio('1 jour (24 h)'));
  fireEvent.click(confirm());
  expect(adminCommand).not.toHaveBeenCalled();
  expect(
    screen.getByText('Le motif est obligatoire et ne dépasse pas 2 000 caractères.'),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Motif'), { target: { value: '  Insultes répétées  ' } });
  fireEvent.click(confirm());
  await waitFor(() => expect(notice('status')).toBe('Maison Alpha réduite au silence.'));
  expect(adminCommand.mock.calls[0]?.slice(0, 3)).toEqual([
    'admin.sanction',
    { userId: id(701), kind: 'silence', hours: 24, reason: 'Insultes répétées' },
    'token',
  ]);
});

it('une seule durée proposée est choisie d’office ; les libellés existent en anglais', async () => {
  await opened([
    {
      ok: true,
      data: { sanctionId: id(303), kind: 'warning', startsAt: NOW, endsAt: NOW, pending: false },
    },
  ]);
  fireEvent.click(gesture('Alpha', 'Avertir'));
  expect(radio('7 jours (168 h)').checked).toBe(true);
  fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'Ton agressif' } });
  fireEvent.click(screen.getByRole('button', { name: "Confirmer l'avertissement" }));
  await waitFor(() => expect(adminCommand).toHaveBeenCalledTimes(1));
  expect(adminCommand.mock.calls[0]?.[1]).toMatchObject({ kind: 'warning', hours: 168 });
  await waitFor(() => expect(notice('status')).toBe('Avertissement prononcé à la maison Alpha.'));
  fireEvent.click(gesture('Delta', 'Réduire au silence'));
  await i18n.changeLanguage('en');
  expect(screen.getByRole('group', { name: 'Duration' })).toBeTruthy();
  expect(radio('1 hour').checked).toBe(false);
  expect(radio('3 days (72 h)')).toBeTruthy();
});

it('sans durée lisible, la sanction à durée ne part pas ; l’exclusion, si', async () => {
  // `null` : version en vigueur illisible ; champ absent : API antérieure à #541.
  const older: Partial<AdminReports> = { ...REPORTS };
  delete older.sanctionHours;
  for (const data of [{ ...REPORTS, sanctionHours: null }, older]) {
    adminGet.mockResolvedValue({ ok: true, data });
    render(<Moderation accessToken="token" />);
    await findEntry('Alpha');
    fireEvent.click(gesture('Alpha', 'Suspendre'));
    const group = screen.getByRole('group', { name: 'Durée' });
    expect(within(group).queryByRole('radio')).toBeNull();
    const unavailable = within(group).getByText(/^Aucune durée proposée n'a pu être lue/);
    fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'Récidive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suspension' }));
    expect(adminCommand).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(unavailable);
    cleanup();
  }
});

it('durée retirée entre-temps : le refus est expliqué, les durées relues, le choix est à refaire', async () => {
  const changed = {
    ...REPORTS,
    sanctionHours: { ...REPORTS.sanctionHours, suspension: [48, 96] },
  } as AdminReports;
  await opened(
    [
      { ok: false, code: 'DURATION_NOT_OFFERED' },
      {
        ok: true,
        data: { sanctionId: id(302), kind: 'ban', startsAt: NOW, endsAt: null, pending: true },
      },
    ],
    changed,
  );
  fireEvent.click(gesture('Alpha', 'Suspendre'));
  fireEvent.click(radio('30 jours (720 h)'));
  fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'Récidive' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suspension' }));
  await waitFor(() => expect(notice('alert')).toMatch(/^Cette durée n'est plus proposée/));
  // Le refus paraît dans la feuille, une seule fois : pas aussi sous elle, dans la page.
  expect(screen.getAllByText(/^Cette durée n'est plus proposée/)).toHaveLength(1);
  // La confirmation reste ouverte, avec les durées relues ; aucune n'est choisie, le motif reste.
  expect(
    screen
      .getAllByRole('radio')
      .map((node) => [node.getAttribute('value'), (node as HTMLInputElement).checked]),
  ).toEqual([
    ['48', false],
    ['96', false],
  ]);
  expect((screen.getByLabelText('Motif') as HTMLTextAreaElement).value).toBe('Récidive');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suspension' }));
  expect(adminCommand).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Choisissez l'une des durées proposées.")).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  fireEvent.click(gesture('Alpha', "Proposer l'exclusion"));
  expect(screen.queryByRole('group', { name: 'Durée' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByLabelText('Motif'));
  fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'Récidive' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer la proposition' }));
  await waitFor(() =>
    expect(notice('status')).toBe(
      'Exclusion de la maison Alpha proposée : un autre compte doit la valider.',
    ),
  );
  expect(adminCommand.mock.calls[1]?.[1]).toEqual({
    userId: id(701),
    kind: 'ban',
    reason: 'Récidive',
  });
});

it('pendant l’envoi, Échap ne referme pas la feuille ; un refus garde les champs et rend le foyer à « Confirmer »', async () => {
  const sent = held<unknown>();
  await opened([sent.promise], REPORTS);
  fireEvent.click(gesture('Alpha', 'Suspendre'));
  fireEvent.click(radio('7 jours (168 h)'));
  fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'Récidive' } });
  const confirm = screen.getByRole('button', { name: 'Confirmer la suspension' });
  fireEvent.click(confirm);
  await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(true));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(screen.getByRole('dialog', { name: 'Suspendre' })).toBeTruthy();
  sent.release({ ok: false, code: 'RATE_LIMITED' });
  await waitFor(() => expect(notice('alert')).toBeTruthy());
  expect(screen.getByRole('dialog', { name: 'Suspendre' })).toBeTruthy();
  expect(radio('7 jours (168 h)').checked).toBe(true);
  expect((screen.getByLabelText('Motif') as HTMLTextAreaElement).value).toBe('Récidive');
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Confirmer la suspension' }),
    ),
  );
});

it('une panne garde l’intention : le renvoi réutilise la clé d’idempotence', async () => {
  const sent = held<unknown>();
  await opened([{ ok: false, code: 'INTERNAL' }, sent.promise], REPORTS);
  const dismiss = () => gesture('Alpha', 'Classer sans suite');
  fireEvent.click(dismiss());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : classer sans suite' }));
  await waitFor(() => expect(notice('alert')).toMatch(/ne sera pas exécutée deux fois/));
  fireEvent.click(dismiss());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : classer sans suite' }));
  // Pendant l'envoi, rien ne se double.
  await waitFor(() => expect(adminCommand).toHaveBeenCalledTimes(2));
  expect((screen.getByRole('button', { name: 'Actualiser' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(adminCommand.mock.calls[1]?.[3]).toBe(adminCommand.mock.calls[0]?.[3]);
  sent.release({ ok: true, data: { reportIds: [id(501)], decision: 'dismissed' } });
  await waitFor(() => expect(notice('status')).toBe('Signalements classés sans suite.'));
});

it('un refus que l’écran ne connaît pas est dit avec son code, sans passer pour une panne rejouable', async () => {
  await opened([{ ok: false, code: 'SOMETHING_NEW' }], REPORTS);
  fireEvent.click(gesture('Alpha', 'Classer sans suite'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : classer sans suite' }));
  await waitFor(() =>
    expect(notice('alert')).toBe("L'API a refusé cette action (code SOMETHING_NEW)."),
  );
  expect(screen.queryByText(/exécutée deux fois/)).toBeNull();
  // L'issue est connue : l'intention n'est pas gardée, le renvoi reçoit une clé neuve.
  adminCommand.mockResolvedValueOnce({ ok: false, code: 'SOMETHING_NEW' });
  fireEvent.click(gesture('Alpha', 'Classer sans suite'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : classer sans suite' }));
  await waitFor(() => expect(adminCommand).toHaveBeenCalledTimes(2));
  expect(adminCommand.mock.calls[1]?.[3]).not.toBe(adminCommand.mock.calls[0]?.[3]);
});

const WITH_SANCTIONS: AdminReports = {
  ...REPORTS,
  queue: [],
  appeals: [
    {
      sanctionId: id(311),
      userId: id(711),
      kind: 'suspension',
      reason: 'Insultes',
      startsAt: '2026-11-16T10:00:00Z',
      endsAt: '2026-11-23T10:00:00Z',
      authorId: id(721),
      appealBody: 'Je regrette',
      appealedAt: '2026-11-17T10:00:00Z',
    },
  ],
  pendingExclusions: [
    {
      sanctionId: id(312),
      userId: id(712),
      reason: 'Triche répétée',
      authorId: id(722),
      proposedAt: '2026-11-17T08:00:00Z',
    },
  ],
  activeExclusions: [
    {
      sanctionId: id(314),
      userId: id(714),
      reason: 'Fraude',
      authorId: id(724),
      confirmedBy: id(734),
      startsAt: '2026-11-09T09:00:00Z',
    },
  ],
  pendingLifts: [
    {
      sanctionId: id(313),
      userId: id(713),
      reason: 'Haine',
      authorId: id(723),
      confirmedBy: id(733),
      startsAt: '2026-11-10T09:00:00Z',
      proposedBy: id(743),
      proposedAt: '2026-11-18T07:00:00Z',
    },
  ],
};
async function openedSanctions(commandReplies: object[], after: AdminReports) {
  adminGet.mockResolvedValueOnce({ ok: true, data: WITH_SANCTIONS });
  adminGet.mockResolvedValue({ ok: true, data: after });
  for (const reply of commandReplies) adminCommand.mockResolvedValueOnce(reply);
  render(<Moderation accessToken="token" />);
  await screen.findByRole('heading', { name: 'Appels à trancher' });
}

it('liste les exclusions à valider et les appels, comptes en entier', async () => {
  expect(adminReportsSchema.safeParse(WITH_SANCTIONS).success).toBe(true);
  await openedSanctions([], WITH_SANCTIONS);
  const exclusion = screen.getByRole('list', { name: 'Exclusions à valider' });
  expect(within(exclusion).getByText(id(712))).toBeTruthy();
  expect(
    within(exclusion).getByText(`Proposée le 17/11/2026 08:00 par le compte ${id(722)}.`),
  ).toBeTruthy();
  expect(within(exclusion).getByText('Motif : Triche répétée')).toBeTruthy();
  const appeal = screen.getByRole('list', { name: 'Appels à trancher' });
  expect(within(appeal).getByText(/^Appel d'une sanction \(suspension\) du compte/)).toBeTruthy();
  expect(within(appeal).getByText(/Du 16\/11\/2026 10:00 au 23\/11\/2026 10:00\./)).toBeTruthy();
  expect(within(appeal).getByText('Appel du 17/11/2026 10:00 : Je regrette')).toBeTruthy();
  expect(within(appeal).getByText('Motif : Insultes')).toBeTruthy();
});

it('valide une exclusion après confirmation ; le refus de la seconde personne est expliqué', async () => {
  await openedSanctions(
    [
      { ok: false, code: 'SECOND_PERSON_REQUIRED' },
      { ok: true, data: { sanctionId: id(312), startsAt: NOW } },
    ],
    WITH_SANCTIONS,
  );
  const validate = () =>
    screen.getByRole('button', { name: `Valider l'exclusion du compte ${id(712).slice(0, 8)}` });
  fireEvent.click(validate());
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' }));
  fireEvent.click(screen.getByRole('button', { name: "Confirmer l'exclusion" }));
  await waitFor(() => expect(notice('alert')).toMatch(/^Un autre compte que l'auteur/));
  expect(document.activeElement).toBe(validate());
  fireEvent.click(validate());
  fireEvent.click(screen.getByRole('button', { name: "Confirmer l'exclusion" }));
  await waitFor(() => expect(notice('status')).toBe('Exclusion validée : elle commence.'));
  expect(adminCommand.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ['admin.confirmExclusion', { sanctionId: id(312) }],
    ['admin.confirmExclusion', { sanctionId: id(312) }],
  ]);
});

it('tranche un appel : accueillir et rejeter envoient la décision, après confirmation', async () => {
  await openedSanctions(
    [
      { ok: true, data: { sanctionId: id(311), decision: 'granted', liftedAt: NOW } },
      { ok: true, data: { sanctionId: id(311), decision: 'rejected', liftedAt: null } },
    ],
    WITH_SANCTIONS,
  );
  const account = id(711).slice(0, 8);
  fireEvent.click(screen.getByRole('button', { name: `Accueillir l'appel du compte ${account}` }));
  const cancel = screen.getByRole('button', { name: 'Annuler' });
  expect(document.getElementById(cancel.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
    `L'appel sera accueilli : la sanction du compte ${id(711)} sera levée à cet instant si elle n'est pas finie.`,
  );
  expect(adminCommand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : accueillir' }));
  await waitFor(() => expect(notice('status')).toBe('Appel accueilli.'));
  fireEvent.click(screen.getByRole('button', { name: `Rejeter l'appel du compte ${account}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : rejeter' }));
  await waitFor(() => expect(notice('status')).toBe('Appel rejeté.'));
  expect(adminCommand.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ['admin.decideAppeal', { sanctionId: id(311), decision: 'granted' }],
    ['admin.decideAppeal', { sanctionId: id(311), decision: 'rejected' }],
  ]);
});

it('Entrée tenue sur « Accueillir l’appel » n’ouvre ni ne confirme rien', async () => {
  await openedSanctions([], WITH_SANCTIONS);
  screen.getByRole('button', { name: new RegExp(`^Accueillir l'appel`) }).focus();
  enter(true);
  expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  enter();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' }));
  enter(true);
  expect(adminCommand).not.toHaveBeenCalled();
});

it('listes vides dites, en français et en anglais', async () => {
  adminGet.mockResolvedValue({ ok: true, data: { ...REPORTS, queue: [] } });
  render(<Moderation accessToken="token" />);
  expect(await screen.findByText('Aucune exclusion à valider.')).toBeTruthy();
  expect(screen.getByText("Aucune levée d'exclusion à confirmer.")).toBeTruthy();
  expect(screen.getByText('Aucun appel à trancher.')).toBeTruthy();
  await i18n.changeLanguage('en');
  expect(screen.getByText('No exclusion to confirm.')).toBeTruthy();
  expect(screen.getByText('No exclusion lift to confirm.')).toBeTruthy();
  expect(screen.getByText('No appeal to decide.')).toBeTruthy();
});

it('liste les levées proposées et en confirme une ; le refus de qui l’a proposée est expliqué (#616)', async () => {
  await openedSanctions(
    [
      { ok: false, code: 'SECOND_PERSON_REQUIRED' },
      { ok: true, data: { sanctionId: id(313), pending: false, liftedAt: NOW } },
    ],
    WITH_SANCTIONS,
  );
  const lifts = screen.getByRole('list', { name: "Levées d'exclusion à confirmer" });
  expect(within(lifts).getByText(id(713))).toBeTruthy();
  expect(
    within(lifts).getByText(`Proposée le 18/11/2026 07:00 par le compte ${id(743)}.`),
  ).toBeTruthy();
  expect(
    within(lifts).getByText(
      `Exclusion en vigueur depuis le 10/11/2026 09:00, prononcée par le compte ${id(723)} et validée par le compte ${id(733)}.`,
    ),
  ).toBeTruthy();
  expect(within(lifts).getByText('Motif : Haine')).toBeTruthy();
  const lift = () =>
    screen.getByRole('button', {
      name: `Confirmer la levée de l'exclusion du compte ${id(713).slice(0, 8)}`,
    });
  fireEvent.click(lift());
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer la levée' }));
  await waitFor(() =>
    expect(notice('alert')).toBe(
      'Ni qui a proposé cette levée ni le compte exclu ne la confirment : un autre compte de la modération doit le faire.',
    ),
  );
  expect(document.activeElement).toBe(lift());
  // Levée confirmée : relue, la file ne la liste plus.
  adminGet.mockResolvedValue({ ok: true, data: { ...WITH_SANCTIONS, pendingLifts: [] } });
  fireEvent.click(lift());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer la levée' }));
  await waitFor(() => expect(notice('status')).toBe("Levée confirmée : l'exclusion prend fin."));
  expect(screen.getByText("Aucune levée d'exclusion à confirmer.")).toBeTruthy();
  expect(adminCommand.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ['admin.liftSanction', { sanctionId: id(313) }],
    ['admin.liftSanction', { sanctionId: id(313) }],
  ]);
});

it('retire une exclusion proposée après confirmation ; chaque refus est expliqué, le foyer revient au bouton (#636)', async () => {
  await openedSanctions(
    [
      { ok: false, code: 'SECOND_PERSON_REQUIRED' },
      { ok: false, code: 'ALREADY_CONFIRMED' },
      { ok: true, data: { sanctionId: id(312), withdrawnAt: NOW } },
    ],
    WITH_SANCTIONS,
  );
  const withdraw = () =>
    screen.getByRole('button', { name: `Retirer l'exclusion du compte ${id(712).slice(0, 8)}` });
  // Ouvrir ne lance rien ; le foyer va à « Annuler » et Entrée tenue ne confirme pas.
  withdraw().focus();
  enter(true);
  expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  enter();
  const cancel = screen.getByRole('button', { name: 'Annuler' });
  expect(document.activeElement).toBe(cancel);
  expect(
    document.getElementById(cancel.getAttribute('aria-describedby') ?? '')?.textContent,
  ).toMatch(new RegExp(`^L'exclusion proposée du compte ${id(712)} sera retirée`));
  enter(true);
  expect(adminCommand).not.toHaveBeenCalled();
  fireEvent.click(cancel);
  expect(document.activeElement).toBe(withdraw());
  const attempt = () => {
    fireEvent.click(withdraw());
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait' }));
  };
  attempt();
  await waitFor(() => expect(notice('alert')).toMatch(/^Le compte exclu ne retire pas/));
  expect(document.activeElement).toBe(withdraw());
  attempt();
  await waitFor(() =>
    expect(notice('alert')).toMatch(/^Cette exclusion est déjà validée : elle ne se retire plus/),
  );
  expect(document.activeElement).toBe(withdraw());
  // Retirée : relue, la file ne la liste plus.
  adminGet.mockResolvedValue({ ok: true, data: { ...WITH_SANCTIONS, pendingExclusions: [] } });
  attempt();
  await waitFor(() => expect(notice('status')).toBe('Exclusion retirée : elle quitte la file.'));
  expect(screen.getByText('Aucune exclusion à valider.')).toBeTruthy();
  expect(adminCommand.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ['admin.withdrawExclusion', { sanctionId: id(312) }],
    ['admin.withdrawExclusion', { sanctionId: id(312) }],
    ['admin.withdrawExclusion', { sanctionId: id(312) }],
  ]);
});

it('le retrait est proposé en anglais, avec ses refus propres (#636)', async () => {
  await openedSanctions([{ ok: false, code: 'SECOND_PERSON_REQUIRED' }], WITH_SANCTIONS);
  await i18n.changeLanguage('en');
  fireEvent.click(
    screen.getByRole('button', {
      name: `Withdraw the exclusion of account ${id(712).slice(0, 8)}`,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm the withdrawal' }));
  await waitFor(() => expect(notice('alert')).toMatch(/^The excluded account does not withdraw/));
});

it('propose la levée d’une exclusion en vigueur ; chaque refus est expliqué ; la file relue la montre à confirmer (#636)', async () => {
  const proposed = { ...WITH_SANCTIONS.pendingLifts[0], sanctionId: id(314), userId: id(714) };
  await openedSanctions(
    [
      { ok: false, code: 'SECOND_PERSON_REQUIRED' },
      { ok: false, code: 'APPEAL_PENDING' },
      { ok: false, code: 'SANCTION_ENDED' },
      { ok: false, code: 'NOT_CONFIRMED' },
      { ok: true, data: { sanctionId: id(314), pending: true, liftedAt: null } },
    ],
    WITH_SANCTIONS,
  );
  const active = screen.getByRole('list', { name: 'Exclusions en vigueur' });
  expect(within(active).getByText(id(714))).toBeTruthy();
  expect(within(active).getByText('Motif : Fraude')).toBeTruthy();
  const propose = () =>
    screen.getByRole('button', {
      name: `Proposer la levée de l'exclusion du compte ${id(714).slice(0, 8)}`,
    });
  propose().focus();
  enter(true);
  expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  enter();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' }));
  enter(true);
  expect(adminCommand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(document.activeElement).toBe(propose());
  for (const refusal of [
    /^Le compte exclu ne lève pas/,
    /^Un appel attend/,
    /^Cette sanction est déjà finie/,
    /^Cette exclusion n'est pas encore validée/,
  ]) {
    fireEvent.click(propose());
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la proposition' }));
    await waitFor(() => expect(notice('alert')).toMatch(refusal));
    expect(document.activeElement).toBe(propose());
  }
  adminGet.mockResolvedValue({
    ok: true,
    data: {
      ...WITH_SANCTIONS,
      activeExclusions: [],
      pendingLifts: [...WITH_SANCTIONS.pendingLifts, proposed],
    },
  });
  fireEvent.click(propose());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer la proposition' }));
  await waitFor(() => expect(notice('status')).toMatch(/^Levée proposée/));
  expect(screen.getByText('Aucune exclusion en vigueur dont proposer la levée.')).toBeTruthy();
  const lifts = screen.getByRole('list', { name: "Levées d'exclusion à confirmer" });
  expect(within(lifts).getByText(id(714))).toBeTruthy();
  expect(adminCommand.mock.calls.map((call) => call.slice(0, 2))).toEqual(
    Array(5).fill(['admin.liftSanction', { sanctionId: id(314) }]),
  );
});

it('lit la file d’une API antérieure aux levées proposées', async () => {
  const older: Partial<AdminReports> = { ...REPORTS };
  delete older.pendingLifts;
  delete older.activeExclusions;
  adminGet.mockResolvedValue({ ok: true, data: older });
  render(<Moderation accessToken="token" />);
  expect(await screen.findByText("Aucune levée d'exclusion à confirmer.")).toBeTruthy();
  expect(screen.getByText('Aucune exclusion en vigueur dont proposer la levée.')).toBeTruthy();
});
