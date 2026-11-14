// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const CONFIGS: Record<string, unknown> = {
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
/** Texte de chaque zone d'annonce d'erreur présente à l'écran. */
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
  }
  expect(api.adminCommand).not.toHaveBeenCalled();
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
  expect(alerts()).toEqual([INVALID]);
  // Corrigé : le message s'efface aussitôt. Une nouvelle faute ne le ramène qu'au contrôle suivant.
  type(editor, '{ "a": 1 }');
  expect(alerts()).toEqual(['']);
  expect(editor.hasAttribute('aria-describedby')).toBe(false);
  type(editor, '{ "a": 1 ');
  expect(alerts()).toEqual(['']);
  fireEvent.blur(editor);
  expect(alerts()).toEqual([INVALID]);
  type(editor, '{ "a": 1 }');
  fireEvent.blur(editor);
  expect(alerts()).toEqual(['']);
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
  // Le bouton d'ouverture reste à sa place : un double clic n'atteint ni « Programmer » ni la confirmation.
  fireEvent.click(button('Ouvrir la version 3'));
  expect(item(3).querySelector('button')).toBe(button('Ouvrir la version 3'));
  expect(screen.getAllByRole('button', { name: 'Remplacer le texte' })).toHaveLength(1);
  for (const choice of ['Remplacer le texte', 'Garder le texte modifié'])
    expect(
      document.getElementById(button(choice).getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe(
      "Le texte modifié de la version 2 n'est pas enregistré : ouvrir la version 3 le remplacera.",
    );
  // Y renoncer : rien n'est lu, le texte reste, le foyer revient au bouton d'ouverture.
  fireEvent.click(keep);
  expect(document.activeElement).toBe(button('Ouvrir la version 3'));
  expect(editor.value).toBe('{"saisie":1}');
  expect(api.adminGet.mock.calls.length).toBe(reads);
  // Confirmer : la version demandée remplace le texte, son titre reçoit le foyer.
  fireEvent.click(button('Ouvrir la version 3'));
  fireEvent.click(button('Remplacer le texte'));
  const title = await screen.findByRole('heading', { name: 'Contenu de la version 3' });
  await waitFor(() => expect(document.activeElement).toBe(title));
  expect(editor.value).toBe(JSON.stringify(CONFIGS['v3'], null, 2));
  expect(screen.queryByRole('button', { name: 'Remplacer le texte' })).toBeNull();
});

it('Entrée tenue sur « Ouvrir » ne remplace rien ; rouvrir la version ouverte demande aussi confirmation', async () => {
  const editor = await openVersion(2);
  type(editor);
  const open = () => button('Ouvrir la version 2');
  open().focus();
  // Seule Entrée tenue est ignorée : Tab tenue continue de parcourir les boutons.
  expect(fireEvent.keyDown(open(), { key: 'Tab', repeat: true })).toBe(true);
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
  expect((await screen.findByText('Lecture impossible pour le moment.')).getAttribute('role')).toBe(
    'alert',
  );
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
  fireEvent.click(button('Garder le texte modifié'));
  await waitFor(() => expect(publish.hasAttribute('disabled')).toBe(false));
  fireEvent.click(publish);
  await screen.findByText(/Version 4 enregistrée/);
  fireEvent.click(button('Ouvrir la version 3'));
  expect(screen.queryByRole('button', { name: 'Remplacer le texte' })).toBeNull();
  await screen.findByRole('heading', { name: 'Contenu de la version 3' });
  expect(editor.value).toBe(JSON.stringify(CONFIGS['v3'], null, 2));
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
