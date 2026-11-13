import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Rend l'identifiant du compte Supabase porté par le jeton, ou `null` si le jeton est invalide. */
export type TokenVerifier = (token: string) => Promise<string | null>;

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
      return typeof payload.sub === 'string' && payload.sub !== '' ? payload.sub : null;
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
