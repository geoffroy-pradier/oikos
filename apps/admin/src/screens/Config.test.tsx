// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { held } from '../test/fakes';
import { Config } from './Config';

const api = vi.hoisted(() => ({ adminGet: vi.fn(), adminCommand: vi.fn() }));
vi.mock('../api', () => api);

// Programmation telle que la lecture des paramètres la rend (`apps/api/src/admin-read.ts`).
const activation = (id: string, versionId: string, activateAt: string, cancelledAt?: string) => ({
  id,
  versionId,
  activateAt,
  createdBy: 'bbbbbbbb-0000',
  createdAt: '2026-11-13T11:00:00Z',
  cancelledAt: cancelledAt ?? null,
  cancelledBy: cancelledAt ? 'bbbbbbbb-0000' : null,
});
// Sortie de `admin.cancelActivation` : la programmation désignée, puis toutes celles de sa clôture.
const cancelOutput = (...others: string[]) => ({
  activationId: 'a3',
  versionId: 'v3',
  activateAt: '2999-01-01T00:00:00Z',
  cancelled: ['a3', ...others].map((activationId) => ({ activationId, versionId: 'v3' })),
});
const CANCELLED = activation('a3', 'v3', '2999-01-01T00:00:00Z', '2026-11-14T09:00:00Z');
const LISTING = {
  activeVersionId: 'v2',
  versions: [
    {
      id: 'v3',
      number: 3,
      note: 'essai',
      createdBy: 'aaaaaaaa-0000',
      createdAt: '2026-11-13T10:00:00Z',
    },
    { id: 'v2', number: 2, note: '', createdBy: null, createdAt: '2026-11-12T10:00:00Z' },
    { id: 'v1', number: 1, note: 'initiale', createdBy: null, createdAt: '2026-11-11T10:00:00Z' },
  ],
  activations: [
    activation('a3', 'v3', '2999-01-01T00:00:00Z'),
    activation('a1', 'v1', '2020-01-01T00:00:00Z'),
  ],
};
const GOODS = [
  { id: 'wheat', tier: 'raw', referencePriceOboles: 6, elasticity: 0.4 },
  { id: 'bread', tier: 'finished', referencePriceOboles: 30, elasticity: 1 },
];
const CONFIGS: Record<string, unknown> = {
  v1: { clock: {}, goods: GOODS },
  v2: { starting: { grantOboles: 600 } },
  v3: { starting: { grantOboles: 700 } },
};
const item = (number: number) =>
  screen.getByRole('heading', { name: new RegExp(`^Version ${number}`) }).closest('li') ??
  document.body;
const keyOf = (call: number) => api.adminCommand.mock.calls[call]?.[3] as string;
const button = (name: string) => screen.getByRole('button', { name });
const type = (editor: HTMLElement, value = '{"saisie":1}') =>
  fireEvent.change(editor, { target: { value } });
const INVALID = "Ce texte n'est pas un objet JSON valide.";
const alerts = () => screen.getAllByRole('alert').map((zone) => zone.textContent);
/** Entrée comme un navigateur la traite : elle active l'élément qui a le foyer, sauf défaut annulé. */
const enter = (repeat = false) => {
  const target = document.activeElement as HTMLElement;
  if (fireEvent.keyDown(target, { key: 'Enter', repeat })) fireEvent.click(target);
};

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(() => {
  api.adminCommand.mockReset();
  api.adminGet.mockReset();
  api.adminGet.mockImplementation((path: string) => {
    if (path === 'config/versions') return Promise.resolve({ ok: true, data: LISTING });
    const id = path.split('/').at(-1) ?? '';
    return Promise.resolve({
      ok: true,
      data: { id, number: Number(id.slice(1)), config: CONFIGS[id] },
    });
  });
});
afterEach(cleanup);

async function openVersion(number: number, role: 'super_admin' | 'observer' = 'super_admin') {
  render(<Config accessToken="token" role={role} />);
  fireEvent.click(await screen.findByRole('button', { name: `Ouvrir la version ${number}` }));
  return (await screen.findByLabelText('Configuration (JSON)')) as HTMLTextAreaElement;
}

it('liste les versions : en vigueur, programmation à venir seulement, retour arrière', async () => {
  render(<Config accessToken="token" role="super_admin" />);
  await screen.findByRole('heading', { name: /^Version 3/ });
  expect(item(2).textContent).toContain('En vigueur');
  expect(item(3).textContent).not.toContain('En vigueur');
  expect(item(3).textContent).toContain('Programmée pour le');
  // Une activation passée n'est plus une programmation.
  expect(item(1).textContent).not.toContain('Programmée');
  expect(item(2).textContent).toContain('Sans note');
  expect(
    screen.getByRole('button', { name: 'Revenir à la version 1 à la prochaine clôture' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Programmer la version 3 à la prochaine clôture' }),
  ).toBeTruthy();
});

it('un rôle de lecture consulte et compare, sans bouton ni saisie', async () => {
  const editor = await openVersion(3, 'observer');
  expect(screen.getByText(/pas de les modifier/)).toBeTruthy();
  expect(editor.readOnly).toBe(true);
  expect(screen.getByText('starting.grantOboles').closest('li')?.textContent).toContain(
    '600 → 700',
  );
  expect(screen.queryByRole('button', { name: /Programmer|Revenir|Enregistrer/ })).toBeNull();
  expect(screen.queryByLabelText('Note de version')).toBeNull();
});

it("un texte qui n'est pas un objet JSON n'est jamais envoyé : une seule annonce, le champ reprend le foyer", async () => {
  const editor = await openVersion(2);
  for (const text of ['{ "a": ', '[1, 2]', '"texte"']) {
    type(editor, text);
    fireEvent.click(button('Enregistrer comme nouvelle version'));
    // La zone du champ porte seule le message : la zone des résultats ne le redit pas.
    expect(screen.getAllByText(INVALID)).toHaveLength(1);
    expect(alerts()).toEqual([INVALID]);
    expect(document.activeElement).toBe(editor);
    // Entrée tenue sur « Enregistrer » : sa répétition arrive dans le champ et n'y écrit rien. Dès
    // qu'une touche y est enfoncée, tenir Entrée ajoute de nouveau des lignes, comme partout.
    const held = () => fireEvent.keyDown(editor, { key: 'Enter', repeat: true });
    expect([held(), held()]).toEqual([false, false]);
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(held()).toBe(true);
  }
  expect(api.adminCommand).not.toHaveBeenCalled();
});

it('double clic : le second clic n’agit pas dans la liste, ni un clic au pointeur juste après la fermeture d’une confirmation', async () => {
  api.adminCommand.mockResolvedValue({ ok: true, data: { activateAt: '2999-01-01T00:00:00Z' } });
  const editor = await openVersion(2);
  type(editor);
  const schedule = button('Programmer la version 3 à la prochaine clôture');
  const clock = vi.spyOn(performance, 'now');
  const stray = (detail: number, now: number) => {
    clock.mockReturnValue(now);
    const focusKept = !fireEvent.mouseDown(schedule, { detail });
    fireEvent.click(schedule, { detail });
    return focusKept;
  };
  // Souris : le second clic porte le compte 2. Il n'agit pas, et son appui ne prend pas le foyer.
  expect(stray(2, 0)).toBe(true);
  // Toucher : le compte reste à 1. Horloge figée, fermeture à 1000 : ignoré à 1499 ; à 1500, le clic agit.
  for (const [closedAt, ask, keep] of [
    [1000, 'Ouvrir la version 3', 'Garder le texte modifié'],
    [1500, 'Annuler la programmation de la version 3', 'Garder la programmation'],
  ] as const) {
    clock.mockReturnValue(closedAt);
    fireEvent.click(button(ask), { detail: 1 });
    fireEvent.click(button(keep), { detail: 1 });
    expect(stray(1, closedAt + 499)).toBe(true);
  }
  expect(api.adminCommand).not.toHaveBeenCalled();
  expect(stray(1, 2000)).toBe(false);
  clock.mockRestore();
  await waitFor(() => expect(api.adminCommand).toHaveBeenCalledTimes(1));
});

it('texte invalide : rien n’est annoncé à la frappe ; contrôle à la sortie du champ, sans répétition', async () => {
  const editor = await openVersion(2);
  // Chaque état intermédiaire d'une frappe est invalide : aucun n'est annoncé ni marqué.
  for (const value of ['{', '{ "a"', '{ "a": ']) {
    type(editor, value);
    expect(alerts()).toEqual(['']);
    expect(editor.getAttribute('aria-invalid')).toBe('false');
  }
  fireEvent.blur(editor);
  expect(alerts()).toEqual([INVALID]);
  expect(editor.getAttribute('aria-invalid')).toBe('true');
  const zone = screen.getByText(INVALID);
  expect(zone.id).toBe(editor.getAttribute('aria-describedby'));
  // Encore invalide : la zone ne change pas, un lecteur d'écran n'a rien de nouveau à annoncer.
  const changes = new MutationObserver(() => undefined);
  changes.observe(zone, { childList: true, characterData: true, subtree: true });
  type(editor, '{ "a": 1');
  expect(changes.takeRecords()).toEqual([]);
  changes.disconnect();
  // Corrigé : le message s'efface aussitôt. Une nouvelle faute ne le ramène qu'au contrôle suivant.
  type(editor, '{ "a": 1 }');
  expect(alerts()).toEqual(['']);
  type(editor, '{ "a": 1 ');
  expect(alerts()).toEqual(['']);
  fireEvent.blur(editor);
  expect(alerts()).toEqual([INVALID]);
});

it('texte modifié : ouvrir une autre version demande confirmation, foyer sur le geste sans effet', async () => {
  const editor = await openVersion(2);
  // Ouverture sans texte à perdre : directe, et le foyer va au titre de la version ouverte.
  const opened = screen.getByRole('heading', { name: 'Contenu de la version 2' });
  await waitFor(() => expect(document.activeElement).toBe(opened));
  type(editor);
  const reads = api.adminGet.mock.calls.length;
  fireEvent.click(button('Ouvrir la version 3'));
  const keep = button('Garder le texte modifié');
  expect(document.activeElement).toBe(keep);
  expect(item(3).contains(keep)).toBe(true);
  // Le bouton d'ouverture reste affiché, à sa place : la confirmation s'ouvre sous la rangée.
  fireEvent.click(button('Ouvrir la version 3'));
  expect(item(3).querySelector('button')).toBe(button('Ouvrir la version 3'));
  expect(screen.getAllByRole('button', { name: 'Remplacer le texte' })).toHaveLength(1);
  expect(document.getElementById(keep.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
    "Le texte modifié de la version 2 n'est pas enregistré : ouvrir la version 3 le remplacera.",
  );
  // Y renoncer : rien n'est lu, le texte reste, le foyer revient au bouton d'ouverture.
  fireEvent.click(keep);
  expect(document.activeElement).toBe(button('Ouvrir la version 3'));
  expect(editor.value).toBe('{"saisie":1}');
  expect(api.adminGet.mock.calls.length).toBe(reads);
  // Y renoncer une seconde fois de suite rend encore le foyer.
  fireEvent.click(button('Ouvrir la version 3'));
  fireEvent.click(button('Garder le texte modifié'));
  expect(document.activeElement).toBe(button('Ouvrir la version 3'));
  // Confirmer : la version demandée remplace le texte, son titre reçoit le foyer.
  fireEvent.click(button('Ouvrir la version 3'));
  fireEvent.click(button('Remplacer le texte'));
  const title = await screen.findByRole('heading', { name: 'Contenu de la version 3' });
  await waitFor(() => expect(document.activeElement).toBe(title));
  expect(editor.value).toBe(JSON.stringify(CONFIGS['v3'], null, 2));
  expect(screen.queryByRole('button', { name: 'Remplacer le texte' })).toBeNull();
  // Texte ouvert intact : une autre version s'ouvre aussitôt, sans confirmation.
  fireEvent.click(button('Ouvrir la version 1'));
  expect(screen.queryByRole('button', { name: 'Remplacer le texte' })).toBeNull();
  await screen.findByRole('heading', { name: 'Contenu de la version 1' });
});

it('Entrée tenue sur « Ouvrir » ne remplace rien ; rouvrir la version ouverte demande aussi confirmation', async () => {
  const editor = await openVersion(2);
  type(editor);
  const open = () => button('Ouvrir la version 2');
  open().focus();
  // Touche tenue : le premier appui ouvre la confirmation, la répétition du clavier n'active rien.
  enter();
  for (let held = 0; held < 3; held += 1) enter(true);
  expect(document.activeElement).toBe(button('Garder le texte modifié'));
  // Second appui distinct : il renonce ; tenu, il ne rouvre pas la confirmation.
  enter();
  enter(true);
  expect(document.activeElement).toBe(open());
  expect(screen.queryByRole('button', { name: 'Remplacer le texte' })).toBeNull();
  expect(editor.value).toBe('{"saisie":1}');
});

it('remplacement confirmé, lecture en panne : le texte reste et le foyer est au bouton d’ouverture', async () => {
  const editor = await openVersion(2);
  type(editor);
  fireEvent.click(button('Ouvrir la version 3'));
  api.adminGet.mockResolvedValue({ ok: false, code: 'INTERNAL' });
  fireEvent.click(button('Remplacer le texte'));
  await screen.findByText('Lecture impossible pour le moment.');
  expect(document.activeElement).toBe(button('Ouvrir la version 3'));
  expect(editor.value).toBe('{"saisie":1}');
  expect(screen.getByRole('heading', { name: 'Contenu de la version 2' })).toBeTruthy();
});

it('texte enregistré comme nouvelle version : plus rien à perdre ; issue inconnue : confirmation', async () => {
  api.adminCommand.mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
  api.adminCommand.mockResolvedValue({ ok: true, data: { number: 4 } });
  const editor = await openVersion(2);
  type(editor);
  const publish = button('Enregistrer comme nouvelle version');
  fireEvent.click(publish);
  await screen.findByText(/ne sera pas exécutée deux fois/);
  fireEvent.click(button('Ouvrir la version 3'));
  expect(button('Remplacer le texte')).toBeTruthy();
  await waitFor(() => expect(publish.hasAttribute('disabled')).toBe(false));
  fireEvent.click(publish);
  await screen.findByText(/Version 4 enregistrée/);
  // Une ouverture directe referme la confirmation restée affichée dans une autre fiche.
  fireEvent.click(button('Ouvrir la version 1'));
  expect(screen.queryByRole('button', { name: 'Remplacer le texte' })).toBeNull();
  await screen.findByRole('heading', { name: 'Contenu de la version 1' });
  expect(editor.value).toBe(JSON.stringify(CONFIGS['v1'], null, 2));
});

it('enregistre le contenu saisi et la note, puis relit la liste', async () => {
  api.adminCommand.mockResolvedValue({ ok: true, data: { number: 4 } });
  const editor = await openVersion(2);
  fireEvent.change(editor, { target: { value: '{"starting":{"grantOboles":601}}' } });
  fireEvent.change(screen.getByLabelText('Note de version'), { target: { value: 'plus un' } });
  const reads = api.adminGet.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer comme nouvelle version' }));
  expect((await screen.findByText(/Version 4 enregistrée/)).getAttribute('role')).toBe('status');
  expect(api.adminCommand).toHaveBeenCalledWith(
    'admin.publishConfig',
    { config: { starting: { grantOboles: 601 } }, note: 'plus un' },
    'token',
    expect.stringMatching(/^[0-9a-f-]{36}$/),
  );
  expect(api.adminGet.mock.calls.slice(reads)).toEqual([['config/versions', 'token']]);
});

it('après une panne, la même action garde sa clé ; une autre action en prend une neuve', async () => {
  api.adminCommand.mockResolvedValue({ ok: false, code: 'INTERNAL' });
  render(<Config accessToken="token" role="super_admin" />);
  const schedule3 = await screen.findByRole('button', { name: /Programmer la version 3/ });
  fireEvent.click(schedule3);
  expect((await screen.findByRole('alert')).textContent).toContain(
    'ne sera pas exécutée deux fois',
  );
  fireEvent.click(schedule3);
  await waitFor(() => expect(api.adminCommand).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).toBe(keyOf(0));
  expect(api.adminCommand.mock.calls[1]?.slice(0, 2)).toEqual([
    'admin.scheduleConfig',
    { versionId: 'v3' },
  ]);

  // Réponse de l'API : l'intention est close, la suivante a sa propre clé.
  api.adminCommand.mockResolvedValue({ ok: true, data: { activateAt: '2999-01-01T00:00:00Z' } });
  await waitFor(() => expect(schedule3.hasAttribute('disabled')).toBe(false));
  fireEvent.click(schedule3);
  await screen.findByText(/Version 3 programmée pour le/);
  expect(keyOf(2)).toBe(keyOf(0));
  await waitFor(() => expect(schedule3.hasAttribute('disabled')).toBe(false));
  fireEvent.click(schedule3);
  await waitFor(() => expect(api.adminCommand).toHaveBeenCalledTimes(4));
  expect(keyOf(3)).not.toBe(keyOf(0));
});

it('un refus du schéma nomme les champs ; un refus de rôle a son message', async () => {
  api.adminCommand.mockResolvedValueOnce({
    ok: false,
    code: 'CONFIG_INVALID',
    fields: ['market.npcMaxPriceFactor'],
  });
  await openVersion(2);
  const publish = screen.getByRole('button', { name: 'Enregistrer comme nouvelle version' });
  fireEvent.click(publish);
  // La zone du champ, vide, est aussi une alerte : celle des résultats se cherche par son texte.
  const alert = await screen.findByText(/^Configuration refusée par le schéma/);
  expect(alert.getAttribute('role')).toBe('alert');
  expect(alert.textContent).toContain('market.npcMaxPriceFactor');
  api.adminCommand.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  await waitFor(() => expect(publish.hasAttribute('disabled')).toBe(false));
  fireEvent.click(publish);
  await screen.findByText('Votre rôle ne permet pas cette action.');
});

it("la réponse tardive d'une ouverture plus ancienne ne remplace ni la version ouverte ni la saisie", async () => {
  const slow = held<unknown>();
  const base = api.adminGet.getMockImplementation() as (path: string) => Promise<unknown>;
  api.adminGet.mockImplementation((path: string) =>
    path === 'config/versions/v3' ? slow.promise : base(path),
  );
  render(<Config accessToken="token" role="super_admin" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir la version 3' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la version 1' }));
  const editor = (await screen.findByLabelText('Configuration (JSON)')) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: '{"saisie":1}' } });
  slow.release({ ok: true, data: { id: 'v3', number: 3, config: CONFIGS['v3'] } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.getByRole('heading', { name: 'Contenu de la version 1' })).toBeTruthy();
  expect(editor.value).toBe('{"saisie":1}');
});

it('une saisie faite pendant qu’une version se charge l’emporte : la réponse ne remplace pas le texte', async () => {
  const slow = held<unknown>();
  const editor = await openVersion(2);
  const base = api.adminGet.getMockImplementation() as (path: string) => Promise<unknown>;
  api.adminGet.mockImplementation((path: string) =>
    path === 'config/versions/v3' ? slow.promise : base(path),
  );
  // Texte intact au moment du clic : l'ouverture part sans confirmation, puis la saisie commence.
  fireEvent.click(button('Ouvrir la version 3'));
  type(editor);
  slow.release({ ok: true, data: { id: 'v3', number: 3, config: CONFIGS['v3'] } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.getByRole('heading', { name: 'Contenu de la version 2' })).toBeTruthy();
  expect(editor.value).toBe('{"saisie":1}');
});

it('pour une même clôture, seule la dernière version programmée est signalée', async () => {
  const at = '2999-01-01T00:00:00Z';
  api.adminGet.mockResolvedValue({
    ok: true,
    data: {
      ...LISTING,
      // De la plus récente à la plus ancienne, comme l'API : v1 a été programmée après v3.
      activations: [
        activation('a5', 'v1', at),
        activation('a4', 'v3', at),
        activation('a3', 'v3', '2998-01-01T00:00:00Z'),
        activation('a2', 'v2', '2997-06-01T00:00:00Z'),
        activation('a1', 'v2', '2997-01-01T00:00:00Z'),
      ],
    },
  });
  render(<Config accessToken="token" role="observer" />);
  await screen.findByRole('heading', { name: /^Version 3/ });
  expect(item(1).textContent).toMatch(/Programmée pour le 01\/01\/2999/);
  // v3 a perdu la clôture de 2999 mais garde celle de 2998.
  expect(item(3).textContent).toMatch(/Programmée pour le 01\/01\/2998/);
  // De plusieurs programmations gagnantes, la plus proche est affichée.
  expect(item(2).textContent).toMatch(/Programmée pour le 01\/01\/2997/);
});

it('une programmation annulée n’est plus signalée ; une clôture entièrement annulée ne désigne personne', async () => {
  const [at, cancelledAt] = ['2999-01-01T00:00:00Z', '2026-11-14T09:00:00Z'];
  api.adminGet.mockResolvedValue({
    ok: true,
    data: {
      ...LISTING,
      // Forme rendue par l'API : les annulées restent, marquées. La commande annule toute la clôture.
      activations: [
        activation('a4', 'v1', at, cancelledAt),
        activation('a3', 'v3', at, cancelledAt),
        activation('a2', 'v2', '2998-01-01T00:00:00Z', cancelledAt),
        activation('a1', 'v3', '2998-01-01T00:00:00Z'),
      ],
    },
  });
  render(<Config accessToken="token" role="observer" />);
  await screen.findByRole('heading', { name: /^Version 3/ });
  expect(item(1).textContent).not.toMatch(/Programmée/);
  expect(item(2).textContent).not.toMatch(/Programmée/);
  // Reprogrammée après une annulation : la programmation qui tient est signalée, pas celle de 2999.
  expect(item(3).textContent).toMatch(/Programmée pour le 01\/01\/2998/);
  expect(item(3).textContent).not.toMatch(/2999/);
});

it('annule une programmation à venir après confirmation ; y renoncer ne fait rien', async () => {
  api.adminCommand.mockResolvedValue({ ok: true, data: cancelOutput() });
  render(<Config accessToken="token" role="game_designer" />);
  const name = 'Annuler la programmation de la version 3';
  fireEvent.click(await screen.findByRole('button', { name }));
  // Seule une programmation à venir s'annule : la version 1, déjà entrée en vigueur, n'a pas de bouton.
  expect(screen.queryByRole('button', { name: /^Annuler la programmation/ })).toBeNull();
  // L'avertissement décrit les deux choix : il est lu à l'arrivée du foyer comme sur la confirmation.
  for (const choice of ["Confirmer l'annulation", 'Garder la programmation'])
    expect(
      document.getElementById(
        screen.getByRole('button', { name: choice }).getAttribute('aria-describedby') ?? '',
      )?.textContent,
    ).toMatch(/^Toutes les programmations prévues pour cette clôture seront annulées/);
  fireEvent.click(screen.getByRole('button', { name: 'Garder la programmation' }));
  expect(api.adminCommand).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name }));

  // Après la commande, la lecture rend la programmation marquée annulée.
  fireEvent.click(screen.getByRole('button', { name }));
  api.adminGet.mockResolvedValue({
    ok: true,
    data: { ...LISTING, activations: [CANCELLED] },
  });
  fireEvent.click(screen.getByRole('button', { name: "Confirmer l'annulation" }));
  expect(
    (
      await screen.findByText(/^Programmation de la version 3 pour le 01\/01\/2999.* annulée\.$/)
    ).getAttribute('role'),
  ).toBe('status');
  expect(api.adminCommand.mock.calls.map((call) => call.slice(0, 3))).toEqual([
    ['admin.cancelActivation', { activationId: 'a3' }, 'token'],
  ]);
  expect(screen.queryByRole('button', { name })).toBeNull();
  expect(item(3).textContent).not.toMatch(/Programmée/);
  const title = screen.getByRole('heading', { name: 'Paramètres' });
  await waitFor(() => expect(document.activeElement).toBe(title));
});

it('confirmation : le foyer arrive sur « Garder la programmation » ; une activation répétée ne confirme jamais', async () => {
  api.adminCommand.mockResolvedValue({ ok: true, data: cancelOutput() });
  render(<Config accessToken="token" role="super_admin" />);
  const name = 'Annuler la programmation de la version 3';
  fireEvent.click(await screen.findByRole('button', { name }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Garder la programmation' }),
  );
  // Touche Entrée maintenue sur le bouton d'annulation : chaque répétition active l'élément qui a le
  // foyer. Elle referme et rouvre la confirmation, sans jamais atteindre « Confirmer l'annulation ».
  const activated: (string | null)[] = [];
  for (let repeat = 0; repeat < 6; repeat++) {
    const focused = document.activeElement as HTMLElement;
    activated.push(focused.textContent);
    fireEvent.click(focused);
  }
  expect(activated).toEqual([1, 2, 3].flatMap(() => ['Garder la programmation', name]));
  expect(api.adminCommand).not.toHaveBeenCalled();
});

it('annulation réussie sans y avoir renoncé avant : le foyer va au titre', async () => {
  api.adminCommand.mockResolvedValue({ ok: true, data: cancelOutput() });
  render(<Config accessToken="token" role="super_admin" />);
  const name = 'Annuler la programmation de la version 3';
  fireEvent.click(await screen.findByRole('button', { name }));
  api.adminGet.mockResolvedValue({ ok: true, data: { ...LISTING, activations: [CANCELLED] } });
  fireEvent.click(screen.getByRole('button', { name: "Confirmer l'annulation" }));
  await screen.findByText(/^Programmation de la version 3 .* annulée\.$/);
  expect(screen.queryByRole('button', { name })).toBeNull();
  const title = screen.getByRole('heading', { name: 'Paramètres' });
  await waitFor(() => expect(document.activeElement).toBe(title));
});

it('deux clôtures à venir : le foyer rendu à une programmation ne vole pas la confirmation d’une autre', async () => {
  api.adminGet.mockResolvedValue({
    ok: true,
    data: {
      ...LISTING,
      activations: [
        activation('a5', 'v1', '2998-01-01T00:00:00Z'),
        activation('a3', 'v3', '2999-01-01T00:00:00Z'),
      ],
    },
  });
  render(<Config accessToken="token" role="super_admin" />);
  const cancelA = 'Annuler la programmation de la version 3';
  const cancelB = 'Annuler la programmation de la version 1';
  const keep = () => screen.getByRole('button', { name: 'Garder la programmation' });
  // Renoncer pour A, rouvrir A, puis ouvrir B : la confirmation de B garde le foyer.
  fireEvent.click(await screen.findByRole('button', { name: cancelA }));
  fireEvent.click(keep());
  expect(document.activeElement).toBe(button(cancelA));
  fireEvent.click(button(cancelA));
  fireEvent.click(button(cancelB));
  expect(item(1).contains(keep())).toBe(true);
  expect(document.activeElement).toBe(keep());
  // Le foyer revient à la programmation dont la confirmation se referme, y compris deux fois de suite.
  fireEvent.click(keep());
  expect(document.activeElement).toBe(button(cancelB));
  for (const name of [cancelA, cancelA]) {
    fireEvent.click(button(name));
    expect(item(3).contains(keep())).toBe(true);
    fireEvent.click(keep());
    expect(document.activeElement).toBe(button(name));
  }
  expect(api.adminCommand).not.toHaveBeenCalled();
});

it('annulation : plusieurs programmations de la clôture sont comptées ; un refus est expliqué ; lecture seule sans bouton', async () => {
  api.adminCommand.mockResolvedValueOnce({ ok: false, code: 'CONFIG_ACTIVATION_PAST' });
  api.adminCommand.mockResolvedValue({ ok: true, data: cancelOutput('a4') });
  const view = render(<Config accessToken="token" role="super_admin" />);
  const name = 'Annuler la programmation de la version 3';
  const attempt = async () => {
    fireEvent.click(await screen.findByRole('button', { name }));
    fireEvent.click(screen.getByRole('button', { name: "Confirmer l'annulation" }));
  };
  await attempt();
  expect((await screen.findByText(/^Trop tard pour annuler/)).textContent).toMatch(
    /tombe dans moins d'une minute\. Programmez un retour arrière\.$/,
  );
  // Refusée : la confirmation se referme, le foyer revient au bouton de la programmation.
  const back = () => screen.getByRole('button', { name });
  await waitFor(() => expect(document.activeElement).toBe(back()));
  expect(screen.queryByRole('button', { name: "Confirmer l'annulation" })).toBeNull();
  await attempt();
  expect(await screen.findByText(/annulée, avec 2 programmations de la même clôture/)).toBeTruthy();

  view.unmount();
  render(<Config accessToken="token" role="observer" />);
  await screen.findByRole('heading', { name: /^Version 3/ });
  expect(screen.queryByRole('button', { name })).toBeNull();
});

it('annulation refusée quand la programmation n’est plus à venir : le foyer va au titre', async () => {
  // Un autre compte l'a annulée entre-temps : la liste relue après le refus n'offre plus le bouton.
  render(<Config accessToken="token" role="super_admin" />);
  const name = 'Annuler la programmation de la version 3';
  fireEvent.click(await screen.findByRole('button', { name }));
  api.adminGet.mockResolvedValue({ ok: true, data: { ...LISTING, activations: [CANCELLED] } });
  // Pendant l'envoi, on ne renonce plus : la commande est partie.
  const sent = held<never>();
  api.adminCommand.mockReturnValueOnce(sent.promise);
  fireEvent.click(screen.getByRole('button', { name: "Confirmer l'annulation" }));
  const keep = screen.getByRole('button', { name: 'Garder la programmation' });
  expect((keep as HTMLButtonElement).disabled).toBe(true);
  sent.release({ ok: false, code: 'CONFIG_ACTIVATION_CANCELLED' });
  expect((await screen.findByRole('alert')).textContent).toMatch(/déjà annulée/);
  expect(screen.queryByRole('button', { name })).toBeNull();
  // Le foyer est posé par un effet, après l'annonce : il s'attend.
  const title = screen.getByRole('heading', { name: 'Paramètres' });
  await waitFor(() => expect(document.activeElement).toBe(title));
});

it('la comparaison nomme la version en vigueur et la suit quand elle change', async () => {
  api.adminCommand.mockResolvedValue({ ok: true, data: { activateAt: '2999-01-01T00:00:00Z' } });
  await openVersion(3);
  expect(
    await screen.findByRole('heading', { name: 'Différences avec la version 2, en vigueur' }),
  ).toBeTruthy();
  expect(screen.getByText('starting.grantOboles').closest('li')?.textContent).toContain(
    '600 → 700',
  );
  // La clôture est passée : la liste relue après une commande désigne la version 3.
  const base = api.adminGet.getMockImplementation() as (path: string) => Promise<unknown>;
  api.adminGet.mockImplementation((path: string) =>
    path === 'config/versions'
      ? Promise.resolve({ ok: true, data: { ...LISTING, activeVersionId: 'v3' } })
      : base(path),
  );
  fireEvent.click(screen.getByRole('button', { name: /Revenir à la version 1/ }));
  expect(
    await screen.findByRole('heading', { name: 'Différences avec la version 3, en vigueur' }),
  ).toBeTruthy();
  expect(screen.getByText('Aucune différence avec la version 3, en vigueur.')).toBeTruthy();
});

it('un contenu ou une note modifiés après une panne sont une autre intention : nouvelle clé', async () => {
  api.adminCommand.mockResolvedValue({ ok: false, code: 'INTERNAL' });
  const editor = await openVersion(2);
  const publish = screen.getByRole('button', { name: 'Enregistrer comme nouvelle version' });
  const send = async (calls: number) => {
    await waitFor(() => expect(publish.hasAttribute('disabled')).toBe(false));
    fireEvent.click(publish);
    await waitFor(() => expect(api.adminCommand).toHaveBeenCalledTimes(calls));
  };
  await send(1);
  await send(2);
  expect(keyOf(1)).toBe(keyOf(0));
  fireEvent.change(editor, { target: { value: '{"starting":{"grantOboles":601}}' } });
  await send(3);
  expect(keyOf(2)).not.toBe(keyOf(0));
  fireEvent.change(screen.getByLabelText('Note de version'), { target: { value: 'autre' } });
  await send(4);
  expect(keyOf(3)).not.toBe(keyOf(2));
});

it("pendant une commande, les actions sont désactivées ; l'ouverture d'une version vide la note", async () => {
  const pendingReply = held<unknown>();
  api.adminCommand.mockReturnValue(pendingReply.promise);
  await openVersion(2);
  fireEvent.change(screen.getByLabelText('Note de version'), { target: { value: 'brouillon' } });
  const publish = screen.getByRole('button', { name: 'Enregistrer comme nouvelle version' });
  const schedule = screen.getByRole('button', { name: /Programmer la version 3/ });
  fireEvent.click(publish);
  await waitFor(() => expect(publish.hasAttribute('disabled')).toBe(true));
  expect(schedule.hasAttribute('disabled')).toBe(true);
  fireEvent.click(schedule);
  fireEvent.click(publish);
  expect(api.adminCommand).toHaveBeenCalledTimes(1);
  pendingReply.release({ ok: true, data: { number: 4 } });
  await waitFor(() => expect(publish.hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la version 3' }));
  await screen.findByRole('heading', { name: 'Contenu de la version 3' });
  expect((screen.getByLabelText('Note de version') as HTMLInputElement).value).toBe('');
});

it('un changement de type reste visible dans la comparaison', async () => {
  const editor = await openVersion(2);
  fireEvent.change(editor, { target: { value: '{"starting":{"grantOboles":"600"}}' } });
  expect(screen.getByText('starting.grantOboles').closest('li')?.textContent).toContain(
    '600 → "600"',
  );
});

it('double validation : le refus de programmer sa propre version est expliqué', async () => {
  api.adminCommand.mockResolvedValue({ ok: false, code: 'CONFIG_REVIEW_REQUIRED' });
  render(<Config accessToken="token" role="game_designer" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Programmer la version 3 à la prochaine clôture' }),
  );
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe(
    "L'auteur d'une version ne la programme pas lui-même : un autre compte doit la relire et la programmer.",
  );
  expect(api.adminCommand.mock.calls[0]?.slice(0, 2)).toEqual([
    'admin.scheduleConfig',
    { versionId: 'v3' },
  ]);
});

it('un refus du schéma désigne table, ligne et champ d’après la configuration envoyée', async () => {
  const fields = [
    'goods[1].elasticity: Too big',
    'weather.rain: wet',
    'goods[1].tier',
    'goods[1].tier',
  ];
  api.adminCommand.mockResolvedValue({ ok: false, code: 'CONFIG_INVALID', fields });
  const editor = await openVersion(2);
  fireEvent.change(editor, { target: { value: '{"goods":[{"id":"wheat"},{"id":"bread"}]}' } });
  const publish = screen.getByRole('button', { name: 'Enregistrer comme nouvelle version' });
  fireEvent.click(publish);
  const alert = await screen.findByText(/^Configuration refusée par le schéma/);
  const lines = () => [...alert.querySelectorAll('li')].map((line) => line.textContent);
  // Chemin inconnu rendu tel quel ; deux erreurs identiques restent deux lignes.
  expect(lines()).toEqual([
    'Biens › bread › élasticité (goods[1].elasticity) — Too big',
    'weather.rain — wet',
    'Biens › bread › niveau (goods[1].tier)',
    'Biens › bread › niveau (goods[1].tier)',
  ]);
  expect(screen.getByText('— Too big').getAttribute('lang')).toBe('en');
  // Le texte change après le refus : l'erreur garde la ligne que l'API a refusée.
  fireEvent.change(editor, { target: { value: '{"goods":[{"id":"fish"},{"id":"wine"}]}' } });
  expect(lines()[0]).toContain('Biens › bread › élasticité');
  // Programmation refusée : elle vise une version enregistrée, pas le texte ouvert. Rang seulement.
  await waitFor(() => expect(publish.hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /^Programmer la version 3/ }));
  await waitFor(() => expect(lines()[0]).toContain('Biens › élément 2 › élasticité (goods[1]'));
  await i18next.changeLanguage('en');
  await waitFor(() => expect(lines()[0]).toContain('Goods › item 2 › elasticity (goods[1]'));
  await i18next.changeLanguage('fr');
});

/** Champ d'un bien, désigné par le nom de son groupe (identifiant ou rang) et par son libellé. */
const cell = (good: string, label: string) =>
  within(screen.getByRole('group', { name: good })).getByLabelText<HTMLInputElement>(label);
const goodsOf = (editor: HTMLTextAreaElement) =>
  (JSON.parse(editor.value) as { goods: Record<string, unknown>[] }).goods;
const PRICE = 'prix de référence (oboles)';

it('formulaire des biens : chaque saisie réécrit le texte, chaque texte lisible se relit dans le formulaire', async () => {
  api.adminCommand.mockResolvedValue({ ok: true, data: { number: 4 } });
  const editor = await openVersion(1);
  expect(screen.getByText('Biens').closest('details')?.open).toBe(false);
  const elasticity = cell('wheat', 'élasticité');
  expect(elasticity.value).toBe('0.4');
  // Frappe à frappe : le champ garde ce qui est tapé (« 1.0 » ne redevient pas « 1 » avant le « 5 »).
  for (const typed of ['1', '1.', '1.0', '1.05']) {
    type(elasticity, typed);
    expect(elasticity.value).toBe(typed);
  }
  expect(cell('bread', 'élasticité').value).toBe('1');
  type(cell('wheat', 'niveau'), 'intermediate');
  const wheat = { ...GOODS[0], tier: 'intermediate', elasticity: 1.05 };
  expect(JSON.parse(editor.value)).toEqual({ clock: {}, goods: [wheat, GOODS[1]] });
  // Virgule décimale ; à la sortie du champ, la valeur du JSON est affichée.
  type(elasticity, '0,45');
  fireEvent.blur(elasticity);
  expect([goodsOf(editor)[0]?.['elasticity'], elasticity.value]).toEqual([0.45, '0.45']);
  // Un prix qui ne se lit pas comme un nombre part en texte, et se montre comme tel : entre guillemets.
  type(cell('wheat', PRICE), '1,000');
  fireEvent.blur(cell('wheat', PRICE));
  expect(cell('wheat', PRICE).value).toBe('"1,000"');
  expect(goodsOf(editor)[0]).toEqual({ ...wheat, referencePriceOboles: '1,000', elasticity: 0.45 });
  // Champ vidé : la clé est retirée, l'autre bien ne bouge pas.
  type(cell('wheat', PRICE), '');
  expect(goodsOf(editor)).toEqual([
    { id: 'wheat', tier: 'intermediate', elasticity: 0.45 },
    GOODS[1],
  ]);
  // Le client compose, l'API contrôle : ce qui part est le texte, tel que le formulaire l'a écrit.
  fireEvent.click(button('Enregistrer comme nouvelle version'));
  await screen.findByText(/^Version 4 enregistrée/);
  expect(api.adminCommand.mock.calls[0]?.[1]).toEqual({
    config: JSON.parse(editor.value),
    note: '',
  });
  // Dans l'autre sens. Un niveau inconnu reste affiché, rien n'est remplacé ; une valeur d'un autre
  // type que le champ est montrée en JSON ; sans identifiant, un bien est désigné par son rang.
  const typed = '{"goods":[{"id":"fish","tier":"legendary","elasticity":"2"},{}]}';
  type(editor, typed);
  expect([cell('fish', 'élasticité').value, cell('fish', PRICE).value]).toEqual(['"2"', '']);
  const options = (good: string) => cell(good, 'niveau').textContent;
  expect(options('fish')).toBe('legendaryMatièreIntermédiaireFiniService');
  expect(options('élément 2')).toBe('— choisir —MatièreIntermédiaireFiniService');
  expect([cell('fish', 'niveau').value, editor.value]).toEqual(['', typed]);
});

it('formulaire des biens : une saisie est un texte modifié et l’emporte sur une ouverture en route ; indisponible sans liste lisible ; lecture seule', async () => {
  const editor = await openVersion(1);
  expect(screen.getByText(/^Chaque saisie réécrit le texte JSON/)).toBeTruthy();
  // Version 2 lente à s'ouvrir : la saisie faite entre-temps reste, sa réponse est ignorée.
  const slow = held<unknown>();
  api.adminGet.mockImplementationOnce(() => slow.promise);
  fireEvent.click(button('Ouvrir la version 2'));
  type(cell('bread', PRICE), '31');
  slow.release({ ok: true, data: { id: 'v2', number: 2, config: CONFIGS['v2'] } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(goodsOf(editor)).toEqual([GOODS[0], { ...GOODS[1], referencePriceOboles: 31 }]);
  fireEvent.click(button('Ouvrir la version 2'));
  expect(document.activeElement).toBe(button('Garder le texte modifié'));
  // Sans liste de biens lisible : plus de champs, la raison est dite ; le texte n'est pas touché.
  for (const text of ['{ "goods": ', '[]', '{"goods":{"wheat":{}}}', '{"goods":[1]}']) {
    type(editor, text);
    expect(screen.getByText(/^Formulaire indisponible/)).toBeTruthy();
    expect(screen.queryAllByLabelText('identifiant')).toEqual([]);
    expect(editor.value).toBe(text);
  }
  cleanup();
  await openVersion(1, 'observer');
  for (const label of ['identifiant', PRICE, 'élasticité'])
    expect(cell('bread', label).readOnly).toBe(true);
  expect(cell('bread', 'niveau').disabled).toBe(true);
  expect(screen.queryByText(/^Chaque saisie réécrit/)).toBeNull();
  expect(screen.queryAllByRole('button', { name: /^(Ajouter un bien|Retirer )/ })).toEqual([]);
});

const REMOVED = (name: string) => `${name} retiré du texte, pas encore enregistré.`;
const announced = () => document.getElementById('goods-announce')?.textContent;

it('formulaire des biens : un ajout écrit un bien vide en fin de liste, foyer sur son identifiant ; c’est un texte modifié', async () => {
  const editor = await openVersion(1);
  fireEvent.click(button('Ajouter un bien'));
  // Aucune valeur inventée : un objet vide, que l'API refusera champ par champ tant qu'il n'est pas rempli.
  expect(JSON.parse(editor.value)).toEqual({ clock: {}, goods: [...GOODS, {}] });
  expect(document.activeElement).toBe(cell('élément 3', 'identifiant'));
  type(cell('élément 3', 'identifiant'), 'fish');
  expect(goodsOf(editor)[2]).toEqual({ id: 'fish' });
  expect(cell('fish', 'niveau').value).toBe('');
  // Même chemin qu'une frappe dans le texte : ouvrir une autre version demande confirmation.
  fireEvent.click(button('Ouvrir la version 2'));
  expect(document.activeElement).toBe(button('Garder le texte modifié'));
});

it('formulaire des biens : un retrait garde le reste du texte, est annoncé, et le foyer va au bien suivant, au précédent, puis à l’ajout', async () => {
  const editor = await openVersion(1);
  // Dernier de la liste : le foyer va au bien précédent.
  fireEvent.click(button('Retirer bread'));
  expect(editor.value).toBe(JSON.stringify({ clock: {}, goods: [GOODS[0]] }, null, 2));
  expect(document.activeElement).toBe(cell('wheat', 'identifiant'));
  expect(announced()).toBe(REMOVED('bread'));
  // Un autre texte retire l'annonce : elle ne vaut que pour le texte que le retrait a écrit.
  fireEvent.click(button('Ajouter un bien'));
  expect(announced()).toBe('');
  // Le bien suivant prend le rang du bien retiré, et le foyer ; sans identifiant, il est nommé par ce rang.
  fireEvent.click(button('Retirer wheat'));
  expect(JSON.parse(editor.value)).toEqual({ clock: {}, goods: [{}] });
  expect(document.activeElement).toBe(cell('élément 1', 'identifiant'));
  expect(announced()).toBe(REMOVED('wheat'));
  // Seul bien : le foyer va au bouton d'ajout. La liste vide part telle quelle, l'API la refusera.
  fireEvent.click(button('Retirer élément 1'));
  expect(JSON.parse(editor.value)).toEqual({ clock: {}, goods: [] });
  expect(document.activeElement).toBe(button('Ajouter un bien'));
  expect(announced()).toBe(REMOVED('élément 1'));
});

it('formulaire des biens : ni Entrée tenue, ni double clic, ni toucher juste après ne retirent un second bien', async () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(10_000);
  const editor = await openVersion(1);
  // Au clavier : le foyer passe dans un champ, où la répétition de la touche ne fait rien.
  button('Retirer wheat').focus();
  enter();
  enter(true);
  enter(true);
  expect(goodsOf(editor)).toEqual([GOODS[1]]);
  type(editor, JSON.stringify({ goods: GOODS }));
  // Double clic : le bien suivant remonte sous le pointeur, le second clic n'agit pas, et son appui ne
  // prend pas le foyer, resté dans le champ du bien suivant.
  fireEvent.click(button('Retirer wheat'), { detail: 1 });
  expect(fireEvent.mouseDown(button('Retirer bread'), { detail: 2 })).toBe(false);
  fireEvent.click(button('Retirer bread'), { detail: 2 });
  expect(goodsOf(editor)).toEqual([GOODS[1]]);
  expect(document.activeElement).toBe(cell('bread', 'identifiant'));
  // Toucher (compte de clics toujours à 1) : ignoré juste après, pris en compte passé le délai.
  now.mockReturnValue(10_300);
  fireEvent.click(button('Retirer bread'), { detail: 1 });
  expect(goodsOf(editor)).toEqual([GOODS[1]]);
  now.mockReturnValue(11_000);
  fireEvent.click(button('Ajouter un bien'), { detail: 1 });
  fireEvent.click(button('Ajouter un bien'), { detail: 2 });
  expect(goodsOf(editor)).toEqual([GOODS[1], {}]);
  // Souris : le compte de clics suffit, un clic simple voulu aussitôt après agit (ajouter puis retirer).
  const mouseClick = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  Object.defineProperty(mouseClick, 'pointerType', { value: 'mouse' });
  fireEvent(button('Retirer élément 2'), mouseClick);
  expect(goodsOf(editor)).toEqual([GOODS[1]]);
  expect(announced()).toBe(REMOVED('élément 2'));
  now.mockRestore();
});

it('formulaire des biens : deux retraits de suite au même nom font deux annonces ; Entrée tenue sur l’ajout n’ajoute rien', async () => {
  const editor = await openVersion(1);
  type(editor, '{"goods":[{},{}]}');
  const region = document.getElementById('goods-announce');
  fireEvent.click(button('Retirer élément 1'));
  const first = region?.firstChild;
  expect(announced()).toBe(REMOVED('élément 1'));
  // Même texte, nœud neuf : le lecteur d'écran lit la seconde annonce.
  fireEvent.click(button('Retirer élément 1'));
  expect([announced(), region?.firstChild === first]).toEqual([REMOVED('élément 1'), false]);
  // Le seul bien retiré, le foyer est sur l'ajout : la répétition de la touche n'y ajoute rien.
  expect(document.activeElement).toBe(button('Ajouter un bien'));
  enter(true);
  enter(true);
  expect(goodsOf(editor)).toEqual([]);
  enter();
  expect(goodsOf(editor)).toEqual([{}]);
});
