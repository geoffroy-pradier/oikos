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
    expect(await figure('Commandes réussies (24 h)')).toBe('300');
    expect(await figure('Commandes refusées (24 h)')).toBe('41');
    expect(await figure('Commandes en panne (24 h)')).toBe('7');
    expect(await figure('Ticks en échec (24 h)')).toBe('2');
    expect(await figure('Tick le plus long (24 h)')).toBe('850 ms');
    expect(await figure('Tâches en attente')).toBe('3');
    expect(await figure('Requêtes sans jeton valide (24 h)')).toBe('91');
    expect(await figure('Requêtes au-delà du débit (24 h)')).toBe('17');
    expect(await figure('Requêtes trop volumineuses (24 h)')).toBe('4');
    expect(await figure('Lectures du back-office refusées (24 h)')).toBe('6');
    expect(await figure('Lectures du back-office (24 h)')).toBe('58');
    expect(await figure('Double validation des paramètres')).toBe('Exigée');
    expect(screen.queryByText(/^Double validation levée/)).toBeNull();
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
