// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
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
    { versionId: 'v3', activateAt: '2999-01-01T00:00:00Z' },
    { versionId: 'v1', activateAt: '2020-01-01T00:00:00Z' },
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
