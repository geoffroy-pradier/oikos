// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { auth, resetAuth, VIGIE } from '../test/fakes';
import { Audit } from './Audit';
import { SecondFactor } from './SecondFactor';
import { Vigie } from './Vigie';

const adminGet = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ adminGet }));
vi.mock('../supabase', async () => ({ supabase: (await import('../test/fakes')).supabase }));

beforeAll(async () => {
  await initI18n('fr');
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
});

describe('Vigie', () => {
  it('chaque compteur porte son intitulé, le tableau des ticks son nom et sa durée', async () => {
    adminGet.mockResolvedValue({ ok: true, data: VIGIE });
    render(<Vigie accessToken="token" />);
    const figure = async (label: string) =>
      (await screen.findByText(label)).parentElement?.querySelector('dd')?.textContent;
    expect(await figure('Commandes réussies (24 h)')).toBe('300');
    expect(await figure('Commandes refusées (24 h)')).toBe('41');
    expect(await figure('Commandes en panne (24 h)')).toBe('7');
    expect(await figure('Ticks en échec (24 h)')).toBe('2');
    expect(await figure('Tick le plus long (24 h)')).toBe('850 ms');
    expect(await figure('Tâches en attente')).toBe('3');
    const table = screen.getByRole('table', { name: 'Dernières exécutions de tick' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['Heure', 'Monde', 'Tick', 'État', 'Durée', 'Erreur']);
    expect(within(table).getByText('120 ms')).toBeTruthy();
    expect(within(table).getByText('Joué')).toBeTruthy();
  });

  it("un refus de l'API est affiché, sans compteur", async () => {
    adminGet.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    render(<Vigie accessToken="token" />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Votre rôle ne donne pas accès à ce module.',
    );
    expect(screen.queryByText('Maisons fondées')).toBeNull();
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

  it('une panne de lecture est affichée', async () => {
    adminGet.mockResolvedValue({ ok: false, code: 'INTERNAL' });
    render(<Audit accessToken="token" />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Lecture impossible pour le moment.',
    );
  });
});
