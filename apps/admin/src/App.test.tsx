// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminReply } from './api';
import { App } from './App';
import { initI18n } from './i18n';
import { auth, held, jwt, resetAuth, sessionOf, setSession, VIGIE } from './test/fakes';

const adminGet = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ adminGet }));
vi.mock('./supabase', async () => ({ supabase: (await import('./test/fakes')).supabase }));

/** Réponses de l'API : `me` au choix du test, modules avec un contenu de démonstration. */
function api(me: AdminReply<{ role: string }> | Promise<AdminReply<{ role: string }>>) {
  adminGet.mockImplementation((path: string) => {
    if (path === 'me') return Promise.resolve(me);
    if (path === 'vigie') return Promise.resolve({ ok: true, data: VIGIE });
    if (path.startsWith('config')) return Promise.resolve({ ok: false, code: 'INTERNAL' });
    return Promise.resolve({ ok: true, data: { entries: [] } });
  });
}
const A1 = jwt('a', 'aal1');
const A2 = jwt('a', 'aal2');
const B1 = jwt('b', 'aal1');
const B2 = jwt('b', 'aal2');
function signedIn(token = A2) {
  auth.session = sessionOf('alice', token);
}
const nav = () => screen.queryByRole('navigation', { name: 'Modules' });
const tabs = () =>
  Array.from(nav()?.querySelectorAll('button') ?? []).map((button) => button.textContent);

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(() => {
  resetAuth();
  adminGet.mockReset();
});
afterEach(cleanup);

describe('accès au back-office', () => {
  it("ne rend ni navigation ni module tant que l'API n'a pas donné le rôle", async () => {
    const me = held<{ role: string }>();
    api(me.promise);
    signedIn();
    render(<App />);
    await waitFor(() => expect(adminGet).toHaveBeenCalledWith('me', A2));
    expect(nav()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Vigie' })).toBeNull();
    expect(adminGet).toHaveBeenCalledTimes(1);

    me.release({ ok: true, data: { role: 'super_admin' } });
    expect(await screen.findByRole('heading', { name: 'Vigie', level: 1 })).toBeTruthy();
    expect(screen.getByText('Rôle : Super-administrateur')).toBeTruthy();
  });

  it("une panne de l'API n'ouvre rien : alerte, aucun module", async () => {
    api({ ok: false, code: 'INTERNAL' });
    signedIn();
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Lecture impossible pour le moment.',
    );
    expect(nav()).toBeNull();
    expect(screen.queryByText(/Rôle :/)).toBeNull();
    expect(adminGet).toHaveBeenCalledTimes(1);
  });

  it('un compte sans rôle est refusé, sans module', async () => {
    api({ ok: false, code: 'FORBIDDEN' });
    signedIn();
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain("n'a pas accès");
    expect(nav()).toBeNull();
  });

  it("n'interroge pas l'API avant le second facteur", async () => {
    api({ ok: true, data: { role: 'super_admin' } });
    signedIn(A1);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Double authentification' })).toBeTruthy();
    await screen.findByRole('img');
    expect(adminGet).not.toHaveBeenCalled();
    expect(nav()).toBeNull();
  });

  it.each([
    ['super_admin', ['Vigie', 'Paramètres', "Journal d'audit"]],
    ['observer', ['Vigie', 'Paramètres', "Journal d'audit"]],
    ['game_designer', ['Vigie', 'Paramètres']],
  ])('le rôle %s voit les onglets prévus', async (role, expected) => {
    api({ ok: true, data: { role } });
    signedIn();
    render(<App />);
    await screen.findByRole('heading', { name: 'Vigie', level: 1 });
    expect(tabs()).toEqual(expected);
  });

  it("un rôle sans module (modérateur) n'a ni onglet ni lecture", async () => {
    api({ ok: true, data: { role: 'moderator' } });
    signedIn();
    render(<App />);
    expect(await screen.findByText('Votre rôle ne donne pas accès à ce module.')).toBeTruthy();
    expect(nav()).toBeNull();
    expect(adminGet).toHaveBeenCalledTimes(1);
  });

  it("l'onglet choisi ouvre son module et se signale comme page courante", async () => {
    api({ ok: true, data: { role: 'observer' } });
    signedIn();
    render(<App />);
    await screen.findByRole('heading', { name: 'Vigie', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: "Journal d'audit" }));
    expect(await screen.findByRole('heading', { name: "Journal d'audit", level: 1 })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: "Journal d'audit" }).getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('button', { name: 'Vigie' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('changement de session', () => {
  it('une réponse arrivée après la déconnexion ne réaffiche ni rôle ni navigation', async () => {
    const me = held<{ role: string }>();
    api(me.promise);
    signedIn();
    render(<App />);
    await waitFor(() => expect(adminGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    await screen.findByRole('heading', { name: 'Connexion à Olympe' });
    me.release({ ok: true, data: { role: 'super_admin' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/Rôle :/)).toBeNull();
    expect(nav()).toBeNull();
  });

  it("le compte suivant repasse le second facteur, sans rien de l'ancien rôle", async () => {
    api({ ok: true, data: { role: 'super_admin' } });
    signedIn();
    render(<App />);
    await screen.findByRole('heading', { name: 'Vigie', level: 1 });
    adminGet.mockClear();

    setSession(sessionOf('bob', B1));
    expect(await screen.findByRole('heading', { name: 'Double authentification' })).toBeTruthy();
    expect(screen.queryByText(/Rôle :/)).toBeNull();
    expect(nav()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Vigie' })).toBeNull();
    expect(adminGet).not.toHaveBeenCalled();
  });

  it("après une panne, le compte suivant voit le chargement, pas l'ancienne erreur", async () => {
    api({ ok: false, code: 'INTERNAL' });
    signedIn();
    render(<App />);
    await screen.findByRole('alert');
    const me = held<{ role: string }>();
    api(me.promise);
    setSession(sessionOf('bob', B2));
    await waitFor(() => expect(adminGet).toHaveBeenCalledWith('me', B2));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Chargement…')).toBeTruthy();
  });

  it("un renouvellement de jeton pendant l'enrôlement garde la clé affichée", async () => {
    api({ ok: true, data: { role: 'super_admin' } });
    signedIn(A1);
    render(<App />);
    expect(await screen.findByText('SECRET1')).toBeTruthy();
    setSession(sessionOf('alice', jwt('a-renewed', 'aal1')));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('SECRET1')).toBeTruthy();
    expect(auth.enrolled).toBe(1);
  });

  it("le code validé ouvre le back-office ; l'API n'est lue qu'avec le nouveau jeton", async () => {
    api({ ok: true, data: { role: 'game_designer' } });
    signedIn(A1);
    render(<App />);
    await screen.findByText('SECRET1');
    fireEvent.change(screen.getByLabelText('Code à six chiffres'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(await screen.findByText('Rôle : Concepteur de jeu')).toBeTruthy();
    await screen.findByText('Maisons fondées');
    const tokens = new Set(adminGet.mock.calls.map((call) => call[1] as string));
    expect([...tokens]).toEqual([jwt('alice-verified', 'aal2')]);
  });

  it('un jeton renouvelé pendant l’usage sert les lectures suivantes, le rôle reste affiché', async () => {
    api({ ok: true, data: { role: 'observer' } });
    signedIn();
    render(<App />);
    await screen.findByText('Maisons fondées');
    adminGet.mockClear();
    // La relecture du rôle tombe en panne : le rôle déjà lu n'est pas retiré.
    api({ ok: false, code: 'INTERNAL' });
    const renewed = jwt('a-renewed', 'aal2');
    setSession(sessionOf('alice', renewed));
    await waitFor(() => expect(adminGet).toHaveBeenCalledWith('me', renewed));
    await waitFor(() => expect(adminGet).toHaveBeenCalledWith('vigie', renewed));
    expect(adminGet.mock.calls.every((call) => call[1] === renewed)).toBe(true);
    expect(screen.getByText('Rôle : Observateur')).toBeTruthy();
    expect(tabs()).toEqual(['Vigie', 'Paramètres', "Journal d'audit"]);
    expect(screen.queryByText('Lecture impossible pour le moment.')).toBeNull();
  });

  it('le même compte revenu sans second facteur ne garde ni rôle ni navigation', async () => {
    api({ ok: true, data: { role: 'super_admin' } });
    signedIn();
    render(<App />);
    await screen.findByText('Maisons fondées');
    adminGet.mockClear();
    setSession(sessionOf('alice', A1));
    expect(await screen.findByRole('heading', { name: 'Double authentification' })).toBeTruthy();
    expect(screen.queryByText(/Rôle :/)).toBeNull();
    expect(nav()).toBeNull();
    expect(screen.queryByText('Maisons fondées')).toBeNull();
    expect(adminGet).not.toHaveBeenCalled();
  });
});

it('la langue du document suit la langue choisie', async () => {
  api({ ok: true, data: { role: 'observer' } });
  render(<App />);
  await screen.findByRole('heading', { name: 'Connexion à Olympe' });
  expect(document.documentElement.lang).toBe('fr');
  fireEvent.change(screen.getByLabelText('Langue'), { target: { value: 'en' } });
  await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr' } });
  await waitFor(() => expect(document.documentElement.lang).toBe('fr'));
});
