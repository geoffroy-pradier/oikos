import type { AdminEconomy } from '@oikos/contracts';
import { AuthApiError, AuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import type { AdminReply } from '../api';

type Listener = (event: string, session: unknown) => void;
/** Réponse de Supabase Auth à un code TOTP faux, telle que la rend son client. */
function refusedCode() {
  return new AuthApiError('Invalid TOTP code entered', 422, 'mfa_verification_failed');
}

/** Faux Supabase Auth, piloté par les tests : session, niveau d'assurance par jeton, facteurs. */
export const auth = {
  session: null as unknown,
  listener: null as Listener | null,
  factors: [] as { id: string; status: 'verified' | 'unverified' }[],
  enrolled: 0,
  unenrolled: [] as string[],
  codes: [] as string[],
  acceptCode: true,
  /** Panne de la lecture des facteurs, tant qu'elle n'est pas remise à `null`. */
  listError: null as { message: string } | null,
  /** Erreur rendue par Supabase Auth quand le code n'est pas accepté : par défaut, code refusé. */
  codeError: refusedCode() as AuthError,
  /** Réponse au renouvellement de la session : refusé (compte effacé), accordé, ou injoignable. */
  refresh: 'refused' as 'refused' | 'renewed' | 'unreachable',
  refreshes: 0,
};

/** Jeton au format de Supabase Auth : le niveau d'assurance est une revendication du jeton. */
export function jwt(name: string, aal: 'aal1' | 'aal2', exp?: number) {
  return `${name}.${btoa(JSON.stringify(exp === undefined ? { aal } : { aal, exp }))}.signature`;
}

export function sessionOf(userId: string, token: string) {
  return { access_token: token, user: { id: userId } };
}

/** Change la session comme le ferait Supabase Auth (connexion, renouvellement, déconnexion). */
export function setSession(session: unknown) {
  auth.session = session;
  auth.listener?.('CHANGED', session);
}

export const supabase = {
  auth: {
    getSession: () => Promise.resolve({ data: { session: auth.session } }),
    onAuthStateChange: (listener: Listener) => {
      auth.listener = listener;
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    // Comme le client de Supabase Auth : un renouvellement refusé retire la session et l'annonce lui-même.
    refreshSession: () => {
      auth.refreshes += 1;
      const user = (auth.session as { user: { id: string } } | null)?.user.id;
      if (auth.refresh === 'renewed' && user) {
        // Jeton neuf, valide une heure (revendication `exp`), comme ceux de Supabase Auth.
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const next = sessionOf(user, jwt(`${user}-renewed-${auth.refreshes}`, 'aal2', exp));
        setSession(next);
        return Promise.resolve({ data: { session: next, user: next.user }, error: null });
      }
      if (auth.refresh === 'unreachable') {
        const error = new AuthRetryableFetchError('Failed to fetch', 0);
        return Promise.resolve({ data: { session: null, user: null }, error });
      }
      setSession(null);
      const error = new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found');
      return Promise.resolve({ data: { session: null, user: null }, error });
    },
    signOut: () => {
      setSession(null);
      return Promise.resolve({ error: null });
    },
    mfa: {
      listFactors: () =>
        Promise.resolve({
          error: auth.listError,
          data: {
            all: auth.factors,
            totp: auth.factors.filter((factor) => factor.status === 'verified'),
          },
        }),
      unenroll: ({ factorId }: { factorId: string }) => {
        auth.unenrolled.push(factorId);
        auth.factors = auth.factors.filter((factor) => factor.id !== factorId);
        return Promise.resolve({ error: null });
      },
      enroll: () => {
        auth.enrolled += 1;
        const id = `factor-${auth.enrolled}`;
        auth.factors.push({ id, status: 'unverified' });
        return Promise.resolve({
          error: null,
          data: {
            id,
            totp: { qr_code: 'data:image/svg+xml;utf8,qr', secret: `SECRET${auth.enrolled}` },
          },
        });
      },
      challengeAndVerify: ({ code }: { factorId: string; code: string }) => {
        auth.codes.push(code);
        if (!auth.acceptCode) return Promise.resolve({ error: auth.codeError });
        // Comme Supabase Auth : après l'aller-retour réseau, une nouvelle session `aal2` est
        // enregistrée et annoncée avant que l'appel ne rende la main.
        return new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
          const user = (auth.session as { user: { id: string } } | null)?.user.id;
          if (user) setSession(sessionOf(user, jwt(`${user}-verified`, 'aal2')));
          return { error: null };
        });
      },
    },
  },
};

export function resetAuth() {
  Object.assign(auth, {
    session: null,
    listener: null,
    factors: [],
    enrolled: 0,
    unenrolled: [],
    codes: [],
    acceptCode: true,
    codeError: refusedCode(),
    listError: null,
    refresh: 'refused',
    refreshes: 0,
  });
}

/** Réponse de l'API retenue jusqu'à `release`. */
export function held<T>() {
  let release: (reply: AdminReply<T>) => void = () => undefined;
  const promise = new Promise<AdminReply<T>>((resolve) => (release = resolve));
  return { promise, release };
}

export const VIGIE = {
  houses: 12,
  activeAccounts24h: 5,
  commands24h: { ok: 300, rejected: 41, failed: 7 },
  ticks24h: { failed: 2, maxDurationMs: 850 },
  voyagesOverdue: 4,
  staleReports: { afterHours: 24, count: 0, oldestHours: null },
  closes24h: { failed: 1, lastError: 'Close step siteUpkeep failed on house h1: boom' },
  recentTicks: [
    {
      worldId: '01900000-0000-7000-8000-000000000001',
      tickIndex: 9,
      status: 'done',
      durationMs: 120,
      error: null,
      createdAt: '2026-11-13T10:00:00Z',
    },
  ],
  queuePending: 3,
  refusals24h: { unauthenticated: 91, payloadTooLarge: 4, rateLimited: 17, forbidden: 6 },
  adminReads24h: 58,
  selfReviewAllowed: false,
  clock: { timezone: 'Europe/Paris', knownToDatabase: true, worlds: 2 },
};

const index = { currentBps: 11_212, previousBps: 10_909, inflationBps: 278 };
const account = (key: string, total: number, ...days: [gameDay: number, amount: number][]) => ({
  key,
  kind: key.startsWith('faucet_') ? ('faucet' as const) : ('sink' as const),
  total,
  days: days.map(([gameDay, amount]) => ({ gameDay, amount })),
});
/** Un monde dans la cible : un prêt remboursé (net négatif) et un compte système que l'écran ne connaît pas. */
export const ECONOMY: AdminEconomy = {
  // Deux fenêtres distinctes : intervertir jours détaillés et fenêtre de prix fait échouer les tests.
  windowDays: 14,
  priceWindowDays: 30,
  inflationTargetBps: { min: 0, max: 300 },
  basketEmpty: false,
  worlds: [
    {
      worldId: '01900000-0000-7000-8000-000000000001',
      slug: 'archipel',
      moneySupply: { total: 5615, houses: 5543, escrow: 70, cityTreasuries: 2, other: 0 },
      systemAccounts: [
        account('faucet_starting_grant', 6000, [20772, 6000]),
        account('faucet_temple_loans', -200, [20771, -200]),
        account('sink_upkeep', 185, [20771, 30], [20772, 155]),
        account('sink_future', 0),
      ],
      priceIndex: {
        ...index,
        status: 'in_target',
        unpricedGoods: [],
        unpricedByWindow: { current: [], previous: [] },
        partialWindow: null,
      },
    },
  ],
};
