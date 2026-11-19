import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Session refusée par l'API (`UNAUTHENTICATED`, #565) : jeton expiré ou invalide, ou compte effacé depuis
 * l'ouverture de la session (remise à zéro de la base, suppression). L'application tente alors de la renouveler,
 * et ne la ferme qu'en cas de refus : elle revient à la connexion d'Olympe, avec un texte qui dit pourquoi.
 */
export const SESSION_ENDED_EVENT = 'olympe:session-ended';

/** Annonce le refus du jeton `token` à l'application (sans effet hors du navigateur). */
export function announceSessionEnded(token: string) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: token }));
}

/** Jeton refusé, porté par l'annonce. */
export const refusedToken = (event: Event) =>
  event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : '';

type Outcome = 'renewed' | 'kept' | 'ended';
type Auth = Pick<SupabaseClient['auth'], 'refreshSession' | 'signOut'>;
/** Dernier renouvellement : le jeton refusé qui l'a demandé, son issue, et le jeton qu'il a rendu. */
interface Renewal {
  refused: string;
  outcome: Promise<Outcome>;
  renewed?: string | undefined;
}
let last: Renewal | null = null;

/** Oublie les renouvellements passés (tests). */
export function forgetRenewals() {
  last = null;
}

/**
 * Marge sur l'expiration (réglage technique) : un jeton qui expire dans moins d'une minute est tenu pour expiré, ce
 * qui couvre l'aller-retour et l'écart restant avec l'horloge de l'API.
 */
const EXPIRY_MARGIN_MS = 60_000;

/** Instant d'expiration du jeton (revendication `exp`), en millisecondes ; `null` s'il est illisible. */
export function expiresAt(token: string): number | null {
  try {
    const payload = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(payload)) as { exp?: unknown };
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

const end = (auth: Auth) => auth.signOut({ scope: 'local' }).then((): Outcome => 'ended');

async function renew(auth: Auth): Promise<{ outcome: Outcome; token?: string }> {
  try {
    const { data, error } = await auth.refreshSession();
    if (!error && data.session) return { outcome: 'renewed', token: data.session.access_token };
    if (error && isAuthRetryableFetchError(error)) return { outcome: 'kept' };
  } catch {
    return { outcome: 'kept' }; // Échec inattendu du client : rien ne prouve que la session est perdue.
  }
  return { outcome: await end(auth) };
}

/**
 * Suite d'un refus `UNAUTHENTICATED` du jeton `refused` : renouveler d'abord la session (jeton expiré au réveil d'un
 * appareil, horloge en retard), et ne la fermer, sur cet appareil seulement, que si Supabase Auth refuse le
 * renouvellement (compte effacé). `renewed` : jeton neuf en place, la commande peut repartir sous la même clé, que
 * l'API n'a pas consommée. `kept` : Auth injoignable, la session reste. `ended` : session fermée.
 * Un seul renouvellement par jeton refusé, que les refus simultanés attendent ensemble. Un jeton issu d'un
 * renouvellement que l'API refuse avant son expiration ferme la session : si l'API refuse ce qu'Auth renouvelle
 * (vérificateur mal réglé, autre base, compte effacé sans fermer ses sessions), aucune boucle de renouvellements.
 * `now` : l'heure de l'API si elle est connue (`serverClock`), pour juger l'expiration malgré une horloge fausse.
 */
export function renewOrEnd(auth: Auth, refused: string, now = Date.now()): Promise<Outcome> {
  if (last?.refused === refused) return last.outcome;
  // Seul un jeton encore valide prouve que l'API refuse ce qu'Auth renouvelle ; expiré (appareil endormi des heures
  // après un renouvellement), il se renouvelle comme un autre. Expiration illisible : tenu pour valide.
  const expiry = expiresAt(refused);
  if (last?.renewed === refused && (expiry === null || expiry > now + EXPIRY_MARGIN_MS)) {
    last = { refused, outcome: end(auth) };
    return last.outcome;
  }
  const current: Renewal = {
    refused,
    outcome: renew(auth).then((result) => {
      current.renewed = result.token;
      // Rien n'a été renouvelé : le prochain refus du même jeton retentera.
      if (result.outcome === 'kept' && last === current) last = null;
      return result.outcome;
    }),
  };
  last = current;
  return current.outcome;
}
