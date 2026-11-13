import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { describe, expect, it } from 'vitest';
import { supabaseTokenVerifier, tokenVerifierFromEnv } from './auth';

const SECRET = 'test-secret-test-secret-test-secret-0123';
const sign = (claims: Record<string, unknown>, secret = SECRET, expiresIn = '5m') =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));

describe('supabaseTokenVerifier', () => {
  const verify = supabaseTokenVerifier(new TextEncoder().encode(SECRET));

  it('rend le compte d’un jeton valide', async () => {
    expect(await verify(await sign({ sub: 'user-1', aud: 'authenticated' }))).toBe('user-1');
  });

  it('refuse une signature étrangère', async () => {
    const forged = await sign({ sub: 'user-1', aud: 'authenticated' }, 'x'.repeat(40));
    expect(await verify(forged)).toBeNull();
  });

  it('refuse un jeton expiré, une audience anonyme, un sujet absent, du bruit', async () => {
    expect(
      await verify(await sign({ sub: 'user-1', aud: 'authenticated' }, SECRET, '-1m')),
    ).toBeNull();
    expect(await verify(await sign({ sub: 'user-1', aud: 'anon' }))).toBeNull();
    expect(await verify(await sign({ aud: 'authenticated' }))).toBeNull();
    expect(await verify('not-a-jwt')).toBeNull();
  });
});

describe('jetons à clé asymétrique (Supabase Auth récent)', () => {
  it('accepte ES256 signé par une clé publiée, refuse une autre clé et refuse HS256', async () => {
    const [trusted, other] = [await generateKeyPair('ES256'), await generateKeyPair('ES256')];
    const jwks = createLocalJWKSet({ keys: [await exportJWK(trusted.publicKey)] });
    const verify = supabaseTokenVerifier(jwks);
    const token = (key: CryptoKey) =>
      new SignJWT({ sub: 'user-2', aud: 'authenticated' })
        .setProtectedHeader({ alg: 'ES256' })
        .setExpirationTime('5m')
        .sign(key);
    expect(await verify(await token(trusted.privateKey))).toBe('user-2');
    expect(await verify(await token(other.privateKey))).toBeNull();
    expect(await verify(await sign({ sub: 'user-2', aud: 'authenticated' }))).toBeNull();
  });
});

describe('tokenVerifierFromEnv', () => {
  it('utilise le secret partagé quand il est fourni', async () => {
    const verify = tokenVerifierFromEnv({ SUPABASE_JWT_SECRET: SECRET });
    expect(await verify(await sign({ sub: 'user-3', aud: 'authenticated' }))).toBe('user-3');
  });

  it('exige une adresse Supabase ou un secret', () => {
    expect(() => tokenVerifierFromEnv({})).toThrow(/SUPABASE_URL/);
  });
});
