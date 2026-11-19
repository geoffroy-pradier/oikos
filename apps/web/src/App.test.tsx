// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from './i18n';

// Refus du jeton par l'API (#565) : la session est d'abord renouvelée (jeton expiré au réveil de l'appareil) ;
// si Supabase Auth refuse (compte effacé par une remise à zéro de la base), retour à la connexion. L'appel part par
// le vrai `sendCommand`.
type Listener = (event: string, session: unknown) => void;
const auth = vi.hoisted(() => ({
  session: null as unknown,
  listener: null as Listener | null,
  signOuts: [] as unknown[],
  /** Réponse de Supabase Auth au renouvellement : refusé (compte effacé), accordé, ou injoignable. */
  refresh: 'refused' as 'refused' | 'renewed' | 'unreachable',
  refreshes: 0,
}));
function emit(event: string, session: unknown) {
  auth.session = session;
  auth.listener?.(event, session);
}
/** Lecture de Supabase : aucune maison pour ce compte, le monde servi et une cité. */
function rows(table: string) {
  const result =
    table === 'worlds'
      ? { data: { id: 'w' }, error: null }
      : table === 'cities'
        ? { data: [{ id: 'k', worldId: 'w', slug: 'kalliste', name: 'Kallistè' }], error: null }
        : { data: null, error: null };
  const query = {
    select: () => query,
    eq: () => query,
    order: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
  };
  return query;
}
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: auth.session } }),
      onAuthStateChange: (listener: Listener) => {
        auth.listener = listener;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      // Comme le client de Supabase Auth : un renouvellement refusé retire la session et l'annonce lui-même.
      refreshSession: () => {
        auth.refreshes += 1;
        if (auth.refresh === 'renewed') {
          const next = session(`renouvelé-${auth.refreshes}`);
          emit('TOKEN_REFRESHED', next);
          return Promise.resolve({ data: { session: next, user: next.user }, error: null });
        }
        if (auth.refresh === 'unreachable') {
          const error = new AuthRetryableFetchError('Failed to fetch', 0);
          return Promise.resolve({ data: { session: null, user: null }, error });
        }
        emit('SIGNED_OUT', null);
        const error = new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found');
        return Promise.resolve({ data: { session: null, user: null }, error });
      },
      signOut: (options?: unknown) => {
        auth.signOuts.push(options);
        emit('SIGNED_OUT', null);
        return Promise.resolve({ error: null });
      },
    },
    from: rows,
  },
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('./router', () => ({ router: { navigate } }));
vi.mock('./data', () => ({
  useRows: () => ({ rows: null, failed: false, reload: () => undefined }),
}));
const { App } = await import('./App');
const { forgetRenewals } = await import('./session');

/** Session au format de Supabase Auth : le jeton porte son expiration (`exp`), une heure plus tard. */
const session = (id: string) => ({
  access_token: `${id}.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.sig`,
  user: { id },
});
const tokenNow = () => (auth.session as { access_token: string }).access_token;
const sentTokens = (fetchImpl: ReturnType<typeof answers>) =>
  fetchImpl.mock.calls.map(([, init]) => new Headers(init?.headers).get('authorization'));
/** Réponses successives de l'API ; la dernière se répète. */
function answers(...replies: [status: number, body: unknown][]) {
  let call = 0;
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    const [status, body] = replies[Math.min(call++, replies.length - 1)] ?? [500, null];
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
}
const REFUSED = [401, { ok: false, error: { code: 'UNAUTHENTICATED', message: '' } }] as const;
async function foundHouse() {
  fireEvent.change(await screen.findByLabelText('Nom de la maison'), {
    target: { value: 'Alcméonides' },
  });
  fireEvent.click(screen.getByRole('radio', { name: 'Kallistè' }));
  fireEvent.click(screen.getByRole('button', { name: 'Fonder la maison' }));
}
const ENDED =
  "Votre session a pris fin : ce compte n'est plus reconnu, ou sa connexion a expiré. " +
  'Reconnectez-vous pour continuer.';

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(() => {
  forgetRenewals();
  Object.assign(auth, {
    session: session('effacé'),
    listener: null,
    signOuts: [],
    refresh: 'refused',
    refreshes: 0,
  });
  navigate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('session refusée par l’API', () => {
  it('compte effacé : renouvellement refusé, la session se ferme, la connexion dit pourquoi et prend le foyer', async () => {
    const fetchImpl = answers([...REFUSED]);
    render(<App />);
    await foundHouse();

    expect(await screen.findByRole('heading', { name: "Entrer dans l'Archipel" })).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(auth.refreshes).toBe(1);
    // Fermée sur cet appareil seulement : le serveur d'authentification ne connaît plus le compte.
    expect(auth.signOuts).toEqual([{ scope: 'local' }]);
    // L'adresse revient à l'accueil : le compte suivant n'hérite pas de l'écran en cours.
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
    const notice = screen.getByRole('status');
    expect(notice.textContent).toBe(ENDED);
    const email = screen.getByLabelText('Adresse e-mail');
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute('aria-describedby')).toBe(notice.id);
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
  });

  it('la connexion suivante efface l’avis : une déconnexion ordinaire n’en montre aucun', async () => {
    answers([...REFUSED]);
    render(<App />);
    await foundHouse();
    await screen.findByText(ENDED);

    emit('SIGNED_IN', session('nouveau'));
    fireEvent.click(await screen.findByRole('button', { name: 'Se déconnecter' }));
    expect(await screen.findByRole('heading', { name: "Entrer dans l'Archipel" })).toBeTruthy();
    expect(screen.queryByText(ENDED)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByLabelText('Adresse e-mail'));
  });

  it('jeton expiré mais renouvelable : la session reste, la commande renvoyée part avec le jeton neuf', async () => {
    auth.refresh = 'renewed';
    const taken = { ok: false, error: { code: 'HOUSE_NAME_TAKEN', message: '' } };
    const fetchImpl = answers([...REFUSED], [409, taken]);
    const first = tokenNow();
    render(<App />);
    await foundHouse();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Votre session doit être renouvelée : réessayez dans un instant.',
      ),
    );
    expect(auth.refreshes).toBe(1);
    expect(auth.signOuts).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByText(ENDED)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fonder la maison' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Ce nom est déjà porté'),
    );
    expect(sentTokens(fetchImpl)).toEqual([`Bearer ${first}`, `Bearer ${tokenNow()}`]);
    expect(auth.refreshes).toBe(1);
    expect(auth.signOuts).toEqual([]);
  });

  it('l’API refuse aussi le jeton neuf : un seul renouvellement, puis déconnexion avec l’avis', async () => {
    auth.refresh = 'renewed';
    const fetchImpl = answers([...REFUSED]);
    render(<App />);
    await foundHouse();
    await waitFor(() => expect(auth.refreshes).toBe(1));
    await screen.findByRole('alert');
    expect(auth.signOuts).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Fonder la maison' }));
    expect(await screen.findByText(ENDED)).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(auth.refreshes).toBe(1);
    expect(auth.signOuts).toEqual([{ scope: 'local' }]);
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('jeton renouvelé refusé après son expiration : nouveau renouvellement, sans déconnexion', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T08:00:00Z'));
    auth.refresh = 'renewed';
    const fetchImpl = answers([...REFUSED]);
    render(<App />);
    await foundHouse();
    await waitFor(() => expect(auth.refreshes).toBe(1));
    await screen.findByRole('alert');
    const renewed = tokenNow();

    // Appareil endormi deux heures : le jeton issu du renouvellement a expiré, il se renouvelle à son tour.
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
    fireEvent.click(screen.getByRole('button', { name: 'Fonder la maison' }));
    await waitFor(() => expect(auth.refreshes).toBe(2));
    expect(sentTokens(fetchImpl)[1]).toBe(`Bearer ${renewed}`);
    expect(tokenNow()).not.toBe(renewed);
    expect(auth.signOuts).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();

    // Le jeton neuf, valide, refusé à son tour : la session se ferme, sans troisième renouvellement.
    fireEvent.click(screen.getByRole('button', { name: 'Fonder la maison' }));
    expect(await screen.findByText(ENDED)).toBeTruthy();
    expect(auth.refreshes).toBe(2);
    expect(auth.signOuts).toEqual([{ scope: 'local' }]);
  });

  it('Supabase Auth injoignable : la session et son jeton de renouvellement restent', async () => {
    auth.refresh = 'unreachable';
    answers([...REFUSED]);
    render(<App />);
    await foundHouse();
    await waitFor(() => expect(auth.refreshes).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(auth.signOuts).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeTruthy();
  });

  it('un refus métier laisse la session ouverte, avec son message', async () => {
    answers([409, { ok: false, error: { code: 'HOUSE_NAME_TAKEN', message: 'taken' } }]);
    render(<App />);
    await foundHouse();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Ce nom est déjà porté par une autre maison.',
      ),
    );
    expect(auth.signOuts).toEqual([]);
    expect(auth.refreshes).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeTruthy();
  });
});
