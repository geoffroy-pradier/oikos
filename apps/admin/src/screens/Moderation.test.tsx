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
};
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
const notice = (role: 'status' | 'alert') =>
  screen.getAllByRole(role).find((node) => node.tagName === 'DIV')?.textContent;
const enter = (repeat = false) => {
  const target = document.activeElement as HTMLElement;
  if (fireEvent.keyDown(target, { key: 'Enter', repeat })) fireEvent.click(target);
};

it('la fixture est celle du contrat strict', () => {
  expect(adminReportsSchema.safeParse(REPORTS).success).toBe(true);
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
  const hide = () => within(entryOf('Alpha')).getByRole('button', { name: 'Masquer le message' });
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
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
});

it('Entrée tenue ou redoublée sur un geste n’envoie rien ; seul un appui franc sur « Confirmer » agit', async () => {
  await opened([{ ok: true, data: { messageId: id(1), hiddenAt: NOW } }]);
  within(entryOf('Alpha')).getByRole('button', { name: 'Masquer le message' }).focus();
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
  fireEvent.click(within(entryOf('Alpha')).getByRole('button', { name: 'Classer sans suite' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : classer sans suite' }));
  await waitFor(() => expect(notice('status')).toBe('Signalements classés sans suite.'));
  expect(adminCommand.mock.calls[0]?.slice(0, 2)).toEqual([
    'admin.resolveReport',
    { reportId: id(501), decision: 'dismissed' },
  ]);
  fireEvent.click(within(entryOf('Delta')).getByRole('button', { name: 'Retenir le signalement' }));
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
  fireEvent.click(within(entryOf('Alpha')).getByRole('button', { name: 'Classer sans suite' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : classer sans suite' }));
  await waitFor(() =>
    expect(notice('alert')).toBe(
      "Un autre compte que l'auteur et que le compte concerné doit le faire.",
    ),
  );
  // Le bouton du geste, dans l'entrée qui l'a porté, reprend le foyer.
  expect(document.activeElement).toBe(
    within(entryOf('Alpha')).getByRole('button', { name: 'Classer sans suite' }),
  );
});

it('réduit au silence : durée et motif contrôlés, puis commande avec la durée saisie', async () => {
  await opened([
    {
      ok: true,
      data: { sanctionId: id(301), kind: 'silence', startsAt: NOW, endsAt: NOW, pending: false },
    },
  ]);
  fireEvent.click(within(entryOf('Alpha')).getByRole('button', { name: 'Réduire au silence' }));
  const hours = screen.getByLabelText('Durée (heures)') as HTMLInputElement;
  expect(document.activeElement).toBe(hours);
  const confirm = () => screen.getByRole('button', { name: 'Confirmer le silence' });
  fireEvent.click(confirm());
  expect(adminCommand).not.toHaveBeenCalled();
  expect(screen.getByText("Entrez un nombre entier d'heures, supérieur à zéro.")).toBeTruthy();
  fireEvent.change(hours, { target: { value: '1.5' } });
  fireEvent.click(confirm());
  expect(adminCommand).not.toHaveBeenCalled();
  fireEvent.change(hours, { target: { value: '24' } });
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

it('propose une exclusion sans durée ; refus de durée : les champs restent, l’exclusion n’a pas de durée', async () => {
  await opened(
    [
      { ok: false, code: 'DURATION_NOT_OFFERED' },
      {
        ok: true,
        data: { sanctionId: id(302), kind: 'ban', startsAt: NOW, endsAt: null, pending: true },
      },
    ],
    REPORTS,
  );
  fireEvent.click(within(entryOf('Alpha')).getByRole('button', { name: 'Suspendre' }));
  fireEvent.change(screen.getByLabelText('Durée (heures)'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'Récidive' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suspension' }));
  await waitFor(() => expect(notice('alert')).toMatch(/^Cette durée n'est pas offerte/));
  // Les champs restent à corriger.
  expect((screen.getByLabelText('Durée (heures)') as HTMLInputElement).value).toBe('5');
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  fireEvent.click(within(entryOf('Alpha')).getByRole('button', { name: "Proposer l'exclusion" }));
  expect(screen.queryByLabelText('Durée (heures)')).toBeNull();
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

it('une panne garde l’intention : le renvoi réutilise la clé d’idempotence', async () => {
  const sent = held<unknown>();
  await opened([{ ok: false, code: 'INTERNAL' }, sent.promise], REPORTS);
  const dismiss = () =>
    within(entryOf('Alpha')).getByRole('button', { name: 'Classer sans suite' });
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
  fireEvent.click(within(entryOf('Alpha')).getByRole('button', { name: 'Classer sans suite' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer : classer sans suite' }));
  await waitFor(() =>
    expect(notice('alert')).toBe("L'API a refusé cette action (code SOMETHING_NEW)."),
  );
  expect(screen.queryByText(/exécutée deux fois/)).toBeNull();
  // L'issue est connue : l'intention n'est pas gardée, le renvoi reçoit une clé neuve.
  adminCommand.mockResolvedValueOnce({ ok: false, code: 'SOMETHING_NEW' });
  fireEvent.click(within(entryOf('Alpha')).getByRole('button', { name: 'Classer sans suite' }));
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
  expect(screen.getByText('Aucun appel à trancher.')).toBeTruthy();
  await i18n.changeLanguage('en');
  expect(screen.getByText('No exclusion to confirm.')).toBeTruthy();
  expect(screen.getByText('No appeal to decide.')).toBeTruthy();
});
