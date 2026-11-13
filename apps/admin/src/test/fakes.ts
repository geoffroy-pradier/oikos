import type { AdminReply } from '../api';

type Listener = (event: string, session: unknown) => void;

/** Faux Supabase Auth, piloté par les tests : session, niveau d'assurance par jeton, facteurs. */
export const auth = {
  session: null as unknown,
  listener: null as Listener | null,
  factors: [] as { id: string; status: 'verified' | 'unverified' }[],
  enrolled: 0,
  unenrolled: [] as string[],
  codes: [] as string[],
  acceptCode: true,
};

/** Jeton au format de Supabase Auth : le niveau d'assurance est une revendication du jeton. */
export function jwt(name: string, aal: 'aal1' | 'aal2') {
  return `${name}.${btoa(JSON.stringify({ aal }))}.signature`;
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
    signOut: () => {
      setSession(null);
      return Promise.resolve({ error: null });
    },
    mfa: {
      listFactors: () =>
        Promise.resolve({
          error: null,
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
        if (!auth.acceptCode) return Promise.resolve({ error: { message: 'invalid' } });
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
};
