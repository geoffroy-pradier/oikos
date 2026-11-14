// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { held } from '../test/fakes';
import { Config } from './Config';

const api = vi.hoisted(() => ({ adminGet: vi.fn(), adminCommand: vi.fn() }));
vi.mock('../api', () => api);

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
    { id: 'a3', versionId: 'v3', activateAt: '2999-01-01T00:00:00Z' },
    { id: 'a1', versionId: 'v1', activateAt: '2020-01-01T00:00:00Z' },
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

it("un texte qui n'est pas un objet JSON n'est jamais envoyé", async () => {
  const editor = await openVersion(2);
  for (const text of ['{ "a": ', '[1, 2]', '"texte"']) {
    fireEvent.change(editor, { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer comme nouvelle version' }));
    expect(screen.getAllByRole('alert').at(-1)?.textContent).toContain(
      "n'est pas un objet JSON valide",
    );
  }
  expect(api.adminCommand).not.toHaveBeenCalled();
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
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Configuration refusée par le schéma');
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

it('pour une même clôture, seule la dernière version programmée est signalée', async () => {
  const at = '2999-01-01T00:00:00Z';
  api.adminGet.mockResolvedValue({
    ok: true,
    data: {
      ...LISTING,
      // De la plus récente à la plus ancienne, comme l'API : v1 a été programmée après v3.
      activations: [
        { versionId: 'v1', activateAt: at },
        { versionId: 'v3', activateAt: at },
        { versionId: 'v3', activateAt: '2998-01-01T00:00:00Z' },
        { versionId: 'v2', activateAt: '2997-06-01T00:00:00Z' },
        { versionId: 'v2', activateAt: '2997-01-01T00:00:00Z' },
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
        { versionId: 'v1', activateAt: at, cancelledAt },
        { versionId: 'v3', activateAt: at, cancelledAt },
        { versionId: 'v2', activateAt: '2998-01-01T00:00:00Z', cancelledAt },
        { versionId: 'v3', activateAt: '2998-01-01T00:00:00Z', cancelledAt: null },
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
  const cancelled = { id: 'a3', versionId: 'v3', activateAt: '2999-01-01T00:00:00Z' };
  api.adminCommand.mockResolvedValue({ ok: true, data: { cancelled: [cancelled] } });
  render(<Config accessToken="token" role="game_designer" />);
  const name = 'Annuler la programmation de la version 3';
  fireEvent.click(await screen.findByRole('button', { name }));
  // Seule une programmation à venir s'annule : la version 1, déjà entrée en vigueur, n'a pas de bouton.
  expect(screen.queryByRole('button', { name: /^Annuler la programmation/ })).toBeNull();
  const confirm = screen.getByRole('button', { name: "Confirmer l'annulation" });
  expect(document.activeElement).toBe(confirm);
  expect(
    document.getElementById(confirm.getAttribute('aria-describedby') ?? '')?.textContent,
  ).toMatch(/^Toutes les programmations prévues pour cette clôture seront annulées/);
  fireEvent.click(screen.getByRole('button', { name: 'Garder la programmation' }));
  expect(api.adminCommand).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name }));

  // Après la commande, la lecture rend la programmation marquée annulée.
  fireEvent.click(screen.getByRole('button', { name }));
  api.adminGet.mockResolvedValue({
    ok: true,
    data: { ...LISTING, activations: [{ ...cancelled, cancelledAt: '2026-11-14T09:00:00Z' }] },
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
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Paramètres' }));
});

it('annulation : plusieurs programmations de la clôture sont comptées ; un refus est expliqué ; lecture seule sans bouton', async () => {
  api.adminCommand.mockResolvedValueOnce({ ok: false, code: 'CONFIG_ACTIVATION_PAST' });
  api.adminCommand.mockResolvedValue({ ok: true, data: { cancelled: [{}, {}] } });
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
  expect(screen.queryByRole('button', { name: "Confirmer l'annulation" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name }));
  await attempt();
  expect(await screen.findByText(/annulée, avec 2 programmations de la même clôture/)).toBeTruthy();

  view.unmount();
  render(<Config accessToken="token" role="observer" />);
  await screen.findByRole('heading', { name: /^Version 3/ });
  expect(screen.queryByRole('button', { name })).toBeNull();
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
