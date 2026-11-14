// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { Access } from './Access';

const api = vi.hoisted(() => ({ adminGet: vi.fn(), adminCommand: vi.fn() }));
vi.mock('../api', () => api);
const { adminGet, adminCommand } = api;

const ROOT = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ME = 'bbbbbbbb-0000-4000-8000-00000000000b';
const OTHER = 'cccccccc-0000-4000-8000-00000000000c';
// Forme rendue par `GET /api/admin/roles` : du plus ancien au plus récent, identifiants seuls.
const ROLES = [
  { userId: ROOT, role: 'super_admin', grantedBy: null, grantedAt: '2026-11-01T09:00:00Z' },
  { userId: ME, role: 'super_admin', grantedBy: ROOT, grantedAt: '2026-11-02T09:00:00Z' },
  { userId: OTHER, role: 'moderator', grantedBy: ME, grantedAt: '2026-11-03T09:00:00Z' },
];
const cells = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => Array.from(row.children, (cell) => cell.textContent).slice(0, 3));

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

it('liste chaque compte avec son identifiant entier, son rôle et qui l’a accordé ; le compte courant est signalé', async () => {
  adminGet.mockResolvedValue({ ok: true, data: { roles: ROLES } });
  render(<Access accessToken="token" userId={ME} />);
  const table = await screen.findByRole('table', {
    name: '3 comptes portent un rôle, du plus ancien au plus récent',
  });
  expect(adminGet.mock.calls).toEqual([['roles', 'token']]);
  expect(cells()).toEqual([
    [ROOT, 'Super-administrateur', 'Inscrit en base'],
    [`${ME} (vous)`, 'Super-administrateur', ROOT],
    [OTHER, 'Modérateur', `${ME} (vous)`],
  ]);
  // Le compte nomme sa ligne ; la date suit la langue.
  const row = within(table).getByRole('row', { name: new RegExp(`^${OTHER} Modérateur`) });
  expect(within(row).getByRole('rowheader').textContent).toBe(OTHER);
  expect(row.children[3]?.textContent).toMatch(/^03\/11\/2026/);
});

it('accorde le singulier, et se lit en anglais', async () => {
  adminGet.mockResolvedValue({ ok: true, data: { roles: ROLES.slice(0, 1) } });
  render(<Access accessToken="token" userId={ME} />);
  expect(await screen.findByRole('table', { name: '1 compte porte un rôle' })).toBeTruthy();
  await i18n.changeLanguage('en');
  expect(screen.getByRole('table', { name: '1 account holds a role' })).toBeTruthy();
  expect(cells()).toEqual([[ROOT, 'Super administrator', 'Set in the database']]);
});

it('chargement, puis liste vide', async () => {
  adminGet.mockResolvedValue({ ok: true, data: { roles: [] } });
  render(<Access accessToken="token" userId={ME} />);
  expect(screen.getByText('Chargement…')).toBeTruthy();
  expect(await screen.findByText('Aucun compte ne porte de rôle.')).toBeTruthy();
  expect(screen.queryByText('Chargement…')).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});

it('une lecture en échec le dit ; « Réessayer » la relance et rend le foyer au titre', async () => {
  adminGet.mockResolvedValueOnce({ ok: false, code: 'RATE_LIMITED' });
  adminGet.mockResolvedValue({ ok: true, data: { roles: ROLES } });
  render(<Access accessToken="token" userId={ME} />);
  const failure = 'Trop de demandes en peu de temps. Patientez un instant, puis réessayez.';
  expect((await screen.findByText(failure)).getAttribute('role')).toBe('alert');
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await screen.findByRole('table');
  expect(screen.queryByText(failure)).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Accès', level: 1 })),
  );
});

it('un rôle qui ne donne pas accès au module : refus affiché, rien à relancer', async () => {
  adminGet.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  render(<Access accessToken="token" userId={ME} />);
  const refusal = await screen.findByText('Votre rôle ne donne pas accès à ce module.');
  expect(refusal.getAttribute('role')).toBe('alert');
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
});

const NEW = 'dddddddd-0000-4000-8000-00000000000d';
/** Liste rendue par l'API, puis celle d'après la commande ; réponses successives de la commande. */
async function opened(after: typeof ROLES, ...replies: object[]) {
  adminGet.mockResolvedValueOnce({ ok: true, data: { roles: ROLES } });
  adminGet.mockResolvedValue({ ok: true, data: { roles: after } });
  for (const reply of replies) adminCommand.mockResolvedValueOnce(reply);
  render(<Access accessToken="token" userId={ME} />);
  await screen.findByRole('table');
  return screen.getByLabelText('Identifiant du compte') as HTMLInputElement;
}
const fill = (field: HTMLInputElement, value: string, role = 'moderator') => {
  fireEvent.change(field, { target: { value } });
  fireEvent.change(screen.getByLabelText('Rôle'), { target: { value: role } });
  fireEvent.click(screen.getByRole('button', { name: 'Accorder le rôle' }));
};
const notice = (role: 'status' | 'alert') =>
  screen.getAllByRole(role).find((node) => node.tagName === 'DIV')?.textContent;
const keyOf = (call: number) => adminCommand.mock.calls[call]?.[3] as string;

it('accorde un rôle par identifiant : saisie contrôlée à l’envoi, liste relue, champ vidé', async () => {
  const added = {
    userId: NEW,
    role: 'moderator',
    grantedBy: ME,
    grantedAt: '2026-11-04T09:00:00Z',
  };
  const field = await opened(
    [...ROLES, added],
    { ok: true, data: { userId: NEW, role: 'moderator', previousRole: null } },
    { ok: true, data: { userId: OTHER, role: 'support', previousRole: 'moderator' } },
  );
  fill(field, 'alice@example.test');
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText(/^Ce n'est pas un identifiant de compte/).id).toBe(
    field.getAttribute('aria-describedby')?.split(' ').at(-1),
  );
  expect(document.activeElement).toBe(field);
  expect(adminCommand).not.toHaveBeenCalled();

  // Espaces et majuscules d'un copier-coller : l'identifiant part sous sa forme canonique.
  fill(field, ` ${NEW.toUpperCase()} `);
  await waitFor(() => expect(notice('status')).toBe('Rôle Modérateur accordé.'));
  expect(adminCommand.mock.calls[0]?.slice(0, 3)).toEqual([
    'admin.grantRole',
    { userId: NEW, role: 'moderator' },
    'token',
  ]);
  expect([field.value, field.getAttribute('aria-invalid')]).toEqual(['', null]);
  expect(cells()).toHaveLength(4);
  fill(field, OTHER, 'support');
  await waitFor(() =>
    expect(notice('status')).toBe('Rôle Support accordé, à la place de Modérateur.'),
  );
});

it('un refus est expliqué, la saisie reste ; après une panne, la même demande garde sa clé', async () => {
  const field = await opened(
    ROLES,
    { ok: false, code: 'ROLE_SELF_GRANT' },
    { ok: false, code: 'INTERNAL' },
    { ok: false, code: 'ACCOUNT_NOT_FOUND' },
  );
  fill(field, ME);
  await waitFor(() => expect(notice('alert')).toMatch(/^On ne change pas son propre rôle/));
  expect(field.value).toBe(ME);
  fill(field, NEW);
  await waitFor(() => expect(notice('alert')).toMatch(/elle ne sera pas exécutée deux fois\.$/));
  fill(field, NEW);
  await waitFor(() => expect(notice('alert')).toBe('Aucun compte ne porte cet identifiant.'));
  // Même demande après une panne : même clé ; une autre demande a la sienne.
  expect([keyOf(2) === keyOf(1), keyOf(1) === keyOf(0)]).toEqual([true, false]);
});

it('retire un rôle après confirmation ; annuler ne fait rien et rend le foyer au bouton', async () => {
  await opened(ROLES.slice(0, 2), { ok: true, data: { userId: OTHER, previousRole: 'moderator' } });
  const revoke = () => screen.getByRole('button', { name: 'Retirer le rôle de cccccccc' });
  fireEvent.click(revoke());
  const confirm = screen.getByRole('button', { name: 'Confirmer le retrait' });
  expect(document.activeElement).toBe(confirm);
  expect(document.getElementById(confirm.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
    'Ce compte perdra aussitôt tout accès à Olympe.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(adminCommand).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(revoke());

  fireEvent.click(revoke());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait' }));
  await waitFor(() => expect(notice('status')).toBe('Rôle Modérateur retiré.'));
  expect(adminCommand.mock.calls.map((call) => call.slice(0, 3))).toEqual([
    ['admin.revokeRole', { userId: OTHER }, 'token'],
  ]);
  expect(cells().map((row) => row[0])).toEqual([ROOT, `${ME} (vous)`]);
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Accès', level: 1 }));
});

it('un retrait refusé (dernier super-administrateur) est expliqué, le foyer revient à la ligne', async () => {
  await opened(ROLES, { ok: false, code: 'LAST_SUPER_ADMIN' });
  fireEvent.click(screen.getByRole('button', { name: 'Retirer le rôle de aaaaaaaa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait' }));
  await waitFor(() =>
    expect(notice('alert')).toMatch(/^Il doit toujours rester un super-administrateur/),
  );
  expect(cells()).toHaveLength(3);
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Retirer le rôle de aaaaaaaa' }),
  );
});
