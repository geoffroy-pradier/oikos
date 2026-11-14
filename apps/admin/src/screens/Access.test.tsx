// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { Access } from './Access';

const adminGet = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ adminGet }));

const ROOT = '00000000-0000-4000-8000-00000000000a';
const ME = '00000000-0000-4000-8000-00000000000b';
const OTHER = '00000000-0000-4000-8000-00000000000c';
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
beforeEach(() => adminGet.mockReset());
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
  expect(row.lastElementChild?.textContent).toMatch(/^03\/11\/2026/);
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
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Trop de demandes en peu de temps. Patientez un instant, puis réessayez.',
  );
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await screen.findByRole('table');
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Accès', level: 1 })),
  );
});

it('un rôle qui ne donne pas accès au module : refus affiché, rien à relancer', async () => {
  adminGet.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  render(<Access accessToken="token" userId={ME} />);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Votre rôle ne donne pas accès à ce module.',
  );
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
});
