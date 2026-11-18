import type { Db } from '@oikos/db';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { sql } from 'kysely';

/** Compte authentifié : son identifiant Supabase et le niveau d'assurance de sa session. */
export interface Identity {
  userId: string;
  /** `aal2` : session ouverte avec un second facteur (exigé pour l'administration). */
  aal: 'aal1' | 'aal2';
}

/** Rend le compte porté par le jeton, ou `null` si le jeton est invalide. */
export type TokenVerifier = (token: string) => Promise<Identity | null>;

/**
 * Vérifie les jetons d'accès émis par Supabase Auth (audience `authenticated`).
 * `key` est soit le secret partagé (HS256), soit un jeu de clés publiques (ES256 ou RS256).
 */
export function supabaseTokenVerifier(key: Uint8Array | JWTVerifyGetKey): TokenVerifier {
  const options = {
    audience: 'authenticated',
    requiredClaims: ['exp', 'sub'],
    algorithms: key instanceof Uint8Array ? ['HS256'] : ['ES256', 'RS256'],
  };
  return async (token) => {
    try {
      const { payload } =
        key instanceof Uint8Array
          ? await jwtVerify(token, key, options)
          : await jwtVerify(token, key, options);
      if (typeof payload.sub !== 'string' || payload.sub === '') return null;
      // Sans revendication explicite, la session est tenue pour simple : jamais de second facteur par défaut.
      return { userId: payload.sub, aal: payload['aal'] === 'aal2' ? 'aal2' : 'aal1' };
    } catch {
      return null;
    }
  };
}

/** Longueur minimale d'un secret HS256 (256 bits), comme l'exige Supabase. */
const MIN_SECRET_LENGTH = 32;

/**
 * Choisit la vérification selon l'environnement : clés publiques de Supabase Auth par défaut
 * (aucun secret à partager), secret HS256 si `SUPABASE_JWT_SECRET` est fourni.
 */
export function tokenVerifierFromEnv(env: Record<string, string | undefined>): TokenVerifier {
  if (env['SUPABASE_JWT_SECRET']) {
    if (env['SUPABASE_JWT_SECRET'].length < MIN_SECRET_LENGTH) {
      throw new Error(`SUPABASE_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters long`);
    }
    return supabaseTokenVerifier(new TextEncoder().encode(env['SUPABASE_JWT_SECRET']));
  }
  if (!env['SUPABASE_URL']) throw new Error('Missing SUPABASE_URL or SUPABASE_JWT_SECRET');
  const jwksUrl = new URL('/auth/v1/.well-known/jwks.json', env['SUPABASE_URL']);
  return supabaseTokenVerifier(createRemoteJWKSet(jwksUrl));
}

/** Forme d'un identifiant de compte de Supabase Auth : un UUID, que Postgres accepte sans erreur. */
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ajoute à la vérification du jeton celle de son compte (#565) : un jeton reste valide jusqu'à son expiration,
 * même si son compte a été effacé entre-temps (remise à zéro de la base, suppression). Un compte absent de
 * Supabase Auth, ou effacé en douceur, rend `null`, comme un jeton invalide : refus `UNAUTHENTICATED`, avant la
 * limite de débit (qui écrit en base) et avant le journal des commandes. Le compte est lu après la signature :
 * un jeton forgé n'atteint jamais la base.
 */
export function existingAccountVerifier(db: Db, verifyToken: TokenVerifier): TokenVerifier {
  return async (token) => {
    const identity = await verifyToken(token);
    if (!identity || !ACCOUNT_ID.test(identity.userId)) return null;
    const { rows } = await sql<{ exists: boolean }>`
      select game.auth_user_exists(${identity.userId}::uuid) as exists
    `.execute(db);
    return rows[0]?.exists === true ? identity : null;
  };
}
