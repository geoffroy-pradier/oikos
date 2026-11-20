// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminReply } from './api';
import { App } from './App';
import { initI18n } from './i18n';
import { announceSessionEnded, forgetRenewals } from './session';
import {
  auth,
  ECONOMY,
  held,
  jwt,
  resetAuth,
  sessionOf,
  setSession,
  supabase,
  VIGIE,
} from './test/fakes';

const adminGet = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ adminGet }));
vi.mock('./supabase', async () => ({ supabase: (await import('./test/fakes')).supabase }));

/** Réponses de l'API : `me` au choix du test, modules avec un contenu de démonstration. */
function api(me: AdminReply<{ role: string }> | Promise<AdminReply<{ role: string }>>) {
  adminGet.mockImplementation((path: string) => {
    if (path === 'me') return Promise.resolve(me);
    if (path === 'vigie') return Promise.resolve({ ok: true, data: VIGIE });
    if (path === 'economy') return Promise.resolve({ ok: true, data: ECONOMY });
    if (path.startsWith('config')) return Promise.resolve({ ok: false, code: 'INTERNAL' });
    if (path === 'roles') return Promise.resolve({ ok: true, data: { roles: [] } });
    if (path === 'events')
      return Promise.resolve({
        ok: true,
        data: { now: '2026-11-16T12:00:00.000Z', pastDays: 30, events: [] },
      });
    if (path === 'reports')
      return Promise.resolve({
        ok: true,
        data: {
          now: '2026-11-18T12:00:00Z',
          contextSize: 5,
          staleAfterHours: 24,
          queue: [],
          appeals: [],
          pendingExclusions: [],
        },
      });
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
  forgetRenewals();
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
    // Il lit son identifiant, celui que le super-administrateur saisira pour lui accorder un rôle.
    expect(screen.getByText(/transmettez à un super-administrateur/)).toBeTruthy();
    expect(screen.getByText('alice').tagName).toBe('CODE');
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
    [
      'super_admin',
      ['Vigie', 'Économie', 'Paramètres', 'Animation', 'Modération', "Journal d'audit", 'Accès'],
    ],
    ['observer', ['Vigie', 'Économie', 'Paramètres', 'Animation', "Journal d'audit"]],
    ['game_designer', ['Vigie', 'Économie', 'Paramètres', 'Animation']],
  ])('le rôle %s voit les onglets prévus', async (role, expected) => {
    api({ ok: true, data: { role } });
    signedIn();
    render(<App />);
    await screen.findByRole('heading', { name: 'Vigie', level: 1 });
    expect(tabs()).toEqual(expected);
  });

  it('le responsable communauté n’a que l’Animation, qui s’ouvre sur le calendrier des événements', async () => {
    api({ ok: true, data: { role: 'community_manager' } });
    signedIn();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Calendrier des événements' })).toBeTruthy();
    expect(await screen.findByText('Aucun événement planifié.')).toBeTruthy();
    expect(tabs()).toEqual(['Animation', 'Modération']);
    expect(adminGet).toHaveBeenCalledWith('events', A2);
  });

  it('l’onglet Économie lit sa route et devient la page courante', async () => {
    api({ ok: true, data: { role: 'game_designer' } });
    signedIn();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Économie' }));
    expect(await screen.findByRole('heading', { name: 'Monde « archipel »' })).toBeTruthy();
    expect(adminGet).toHaveBeenCalledWith('economy', A2);
    const current = () =>
      screen.getAllByRole('button').filter((tab) => tab.getAttribute('aria-current') === 'page');
    expect(current().map((tab) => tab.textContent)).toEqual(['Économie']);
  });

  it("le modérateur n'a que la Modération, dont il lit la file, et ne lit rien d'autre", async () => {
    api({ ok: true, data: { role: 'moderator' } });
    signedIn();
    render(<App />);
    expect(await screen.findByText('Aucun signalement en attente.')).toBeTruthy();
    expect(tabs()).toEqual(['Modération']);
    expect(adminGet.mock.calls.map(([path]) => path)).toEqual(['me', 'reports']);
  });

  it("un rôle sans module (support) n'a ni onglet ni lecture", async () => {
    api({ ok: true, data: { role: 'support' } });
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
    // Module réservé au super-administrateur : l'observateur n'en a pas l'onglet.
    expect(screen.queryByRole('button', { name: 'Accès' })).toBeNull();
  });

  it('le super-administrateur ouvre le module Accès, lu avec son jeton', async () => {
    api({ ok: true, data: { role: 'super_admin' } });
    signedIn();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accès' }));
    expect(await screen.findByText('Aucun compte ne porte de rôle.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Accès', level: 1 })).toBeTruthy();
    expect(adminGet).toHaveBeenLastCalledWith('roles', A2);
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
    // La Vigie du premier compte a fini de lire : aucune de ses lectures n'est encore en route.
    await screen.findByText('Maisons fondées');
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
    expect(tabs()).toEqual(['Vigie', 'Économie', 'Paramètres', 'Animation', "Journal d'audit"]);
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

describe('session refusée par l’API (#565)', () => {
  const ENDED =
    "Votre session a pris fin : ce compte n'est plus reconnu, ou sa connexion a expiré. " +
    'Reconnectez-vous pour continuer.';
  /** Comme le vrai client : un refus `UNAUTHENTICATED` annonce la fin de la session, puis rend son code. */
  /** Lectures faites, avec le nom du jeton qui les porte. */
  const names = () =>
    (adminGet.mock.calls as [string, string][]).map(([path, token]) => [path, token.split('.')[0]]);
  const unauthenticated = (_path: string, token: string): Promise<AdminReply<never>> => {
    announceSessionEnded(token);
    return Promise.resolve({ ok: false, code: 'UNAUTHENTICATED' });
  };

  it('compte effacé : renouvellement refusé, Olympe ferme la session dès la lecture du rôle', async () => {
    const signOut = vi.spyOn(supabase.auth, 'signOut');
    adminGet.mockImplementation(unauthenticated);
    signedIn();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Connexion à Olympe' })).toBeTruthy();
    expect(auth.refreshes).toBe(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toBe(ENDED);
    const email = screen.getByLabelText('Adresse e-mail');
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute('aria-describedby')).toBe(notice.id);
    // Rien de l'ancien accès : ni alerte d'accès refusé, ni identifiant, ni navigation.
    expect(screen.queryByText('alice')).toBeNull();
    expect(nav()).toBeNull();
    signOut.mockRestore();
  });

  it('jeton expiré mais renouvelable : Olympe reste ouvert et relit le rôle avec le jeton neuf', async () => {
    const signOut = vi.spyOn(supabase.auth, 'signOut');
    auth.refresh = 'renewed';
    adminGet.mockImplementationOnce(unauthenticated);
    api({ ok: true, data: { role: 'super_admin' } });
    signedIn();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Vigie', level: 1 })).toBeTruthy();
    expect(auth.refreshes).toBe(1);
    expect(signOut).not.toHaveBeenCalled();
    expect(names().filter(([path]) => path === 'me')).toEqual([
      ['me', 'a'],
      ['me', 'alice-renewed-1'],
    ]);
    expect(screen.queryByText(ENDED)).toBeNull();
    signOut.mockRestore();
  });

  it('l’API refuse aussi le jeton neuf : un seul renouvellement, puis déconnexion avec l’avis', async () => {
    const signOut = vi.spyOn(supabase.auth, 'signOut');
    auth.refresh = 'renewed';
    adminGet.mockImplementation(unauthenticated);
    signedIn();
    render(<App />);
    expect(await screen.findByText(ENDED)).toBeTruthy();
    expect(names()).toEqual([
      ['me', 'a'],
      ['me', 'alice-renewed-1'],
    ]);
    expect(auth.refreshes).toBe(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(auth.refreshes).toBe(1);
    signOut.mockRestore();
  });

  it('jeton renouvelé refusé après son expiration : nouveau renouvellement, sans déconnexion', async () => {
    const signOut = vi.spyOn(supabase.auth, 'signOut');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-19T08:00:00Z'));
      auth.refresh = 'renewed';
      adminGet.mockImplementationOnce(unauthenticated);
      api({ ok: true, data: { role: 'super_admin' } });
      signedIn();
      render(<App />);
      await screen.findByRole('heading', { name: 'Vigie', level: 1 });
      expect(auth.refreshes).toBe(1);

      // Onglet laissé ouvert deux heures, appareil endormi : le jeton renouvelé a expiré.
      vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
      adminGet.mockImplementationOnce(unauthenticated);
      fireEvent.click(screen.getByRole('button', { name: 'Économie' }));
      await waitFor(() => expect(names().at(-1)).toEqual(['me', 'alice-renewed-2']));
      expect(auth.refreshes).toBe(2);
      expect(signOut).not.toHaveBeenCalled();
      expect(nav()).not.toBeNull();
      expect(screen.queryByText(ENDED)).toBeNull();
    } finally {
      vi.useRealTimers();
      signOut.mockRestore();
    }
  });

  it('Supabase Auth injoignable : la session reste ouverte, sans avis', async () => {
    const signOut = vi.spyOn(supabase.auth, 'signOut');
    auth.refresh = 'unreachable';
    adminGet.mockImplementation(unauthenticated);
    signedIn();
    render(<App />);
    await waitFor(() => expect(auth.refreshes).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeTruthy();
    expect(screen.queryByText(ENDED)).toBeNull();
    signOut.mockRestore();
  });

  it('refus pendant l’usage d’un module : retour à la connexion ; la suivante efface l’avis', async () => {
    api({ ok: true, data: { role: 'super_admin' } });
    signedIn();
    render(<App />);
    await screen.findByRole('heading', { name: 'Vigie', level: 1 });
    adminGet.mockImplementation(unauthenticated);
    fireEvent.click(screen.getByRole('button', { name: 'Économie' }));
    expect(await screen.findByText(ENDED)).toBeTruthy();
    expect(nav()).toBeNull();

    api({ ok: true, data: { role: 'super_admin' } });
    auth.listener?.('SIGNED_IN', sessionOf('alice', A2));
    await waitFor(() => expect(nav()).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    await screen.findByRole('heading', { name: 'Connexion à Olympe' });
    expect(screen.queryByText(ENDED)).toBeNull();
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

it('le thème sombre se bascule depuis l’en-tête et reste mémorisé', async () => {
  resetAuth();
  render(<App />);
  await screen.findByRole('heading', { name: 'Connexion à Olympe' });
  const toggle = screen.getByRole('button', { name: 'Thème sombre' });
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(toggle);
  expect(document.documentElement.dataset['theme']).toBe('dark');
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('oikos.olympe.theme')).toBe('dark');
  fireEvent.click(toggle);
  expect(document.documentElement.dataset['theme']).toBe('light');
  delete document.documentElement.dataset['theme'];
  localStorage.clear();
});
