import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { expiresAt, forgetRenewals, renewOrEnd } from './session';

// Suite d'un refus `UNAUTHENTICATED` (#565) : un seul renouvellement par jeton refusé, pas de boucle si l'API refuse
// ce qu'Auth renouvelle, mais un jeton renouvelé puis expiré normalement se renouvelle encore.
const T0 = Date.parse('2026-11-19T08:00:00Z');
const HOUR = 3_600_000;
/** Jeton au format de Supabase Auth, qui expire à `exp` (millisecondes). */
const jwt = (name: string, exp: number) =>
  `${name}.${btoa(JSON.stringify({ exp: Math.floor(exp / 1000) }))}.sig`;

/** Faux Supabase Auth : chaque renouvellement accordé rend un jeton valide une heure après `clock`. */
function fakeAuth(answer: 'renewed' | 'refused' | 'unreachable' = 'renewed') {
  const state = { answer, clock: T0, refreshes: 0, signOuts: 0, tokens: [] as string[] };
  const auth = {
    refreshSession: () => {
      state.refreshes += 1;
      if (state.answer === 'renewed') {
        const token = jwt(`renouvelé-${state.refreshes}`, state.clock + HOUR);
        state.tokens.push(token);
        return Promise.resolve({ data: { session: { access_token: token } }, error: null });
      }
      const error =
        state.answer === 'unreachable'
          ? new AuthRetryableFetchError('Failed to fetch', 0)
          : new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found');
      return Promise.resolve({ data: { session: null, user: null }, error });
    },
    signOut: () => {
      state.signOuts += 1;
      return Promise.resolve({ error: null });
    },
  } as unknown as Parameters<typeof renewOrEnd>[0];
  return { auth, state };
}
const first = jwt('premier', T0 + HOUR);

beforeEach(forgetRenewals);

describe('renewOrEnd', () => {
  it('refus simultanés du même jeton : un seul renouvellement', async () => {
    const { auth, state } = fakeAuth();
    const outcomes = await Promise.all([1, 2, 3].map(() => renewOrEnd(auth, first, T0)));
    expect(outcomes).toEqual(['renewed', 'renewed', 'renewed']);
    expect(state.refreshes).toBe(1);
    // Un refus tardif du même jeton (requête partie avant le renouvellement) ne renouvelle pas de nouveau.
    expect(await renewOrEnd(auth, first, T0 + 1000)).toBe('renewed');
    expect(state.refreshes).toBe(1);
  });

  it('jeton renouvelé refusé avant son expiration : session fermée, sans nouveau renouvellement', async () => {
    const { auth, state } = fakeAuth();
    await renewOrEnd(auth, first, T0);
    const renewed = state.tokens[0] ?? '';
    expect(await renewOrEnd(auth, renewed, T0 + 1000)).toBe('ended');
    // Encore valide, à la marge près : une minute et une seconde avant son expiration.
    forgetRenewals();
    await renewOrEnd(auth, first, T0);
    expect(await renewOrEnd(auth, state.tokens[1] ?? '', T0 + HOUR - 61_000)).toBe('ended');
    expect(state).toMatchObject({ refreshes: 2, signOuts: 2 });
  });

  it('jeton renouvelé refusé après son expiration (appareil endormi) : renouvelé de nouveau', async () => {
    const { auth, state } = fakeAuth();
    await renewOrEnd(auth, first, T0);
    const renewed = state.tokens[0] ?? '';
    state.clock = T0 + 2 * HOUR;
    expect(await renewOrEnd(auth, renewed, state.clock)).toBe('renewed');
    expect(state).toMatchObject({ refreshes: 2, signOuts: 0 });
    // Dans la dernière minute de validité, il est déjà tenu pour expiré.
    expect(await renewOrEnd(auth, state.tokens[1] ?? '', state.clock + HOUR - 30_000)).toBe(
      'renewed',
    );
    // Le jeton neuf, valide, refusé à son tour : la session se ferme, sans boucle.
    expect(await renewOrEnd(auth, state.tokens[2] ?? '', state.clock + 1000)).toBe('ended');
    expect(state).toMatchObject({ refreshes: 3, signOuts: 1 });
  });

  it('renouvellement refusé par Auth (compte effacé) : session fermée', async () => {
    const { auth, state } = fakeAuth('refused');
    expect(await renewOrEnd(auth, first, T0)).toBe('ended');
    expect(state).toMatchObject({ refreshes: 1, signOuts: 1 });
  });

  it('Auth injoignable : la session reste, le refus suivant du même jeton retente', async () => {
    const { auth, state } = fakeAuth('unreachable');
    expect(await renewOrEnd(auth, first, T0)).toBe('kept');
    state.answer = 'renewed';
    expect(await renewOrEnd(auth, first, T0)).toBe('renewed');
    expect(state).toMatchObject({ refreshes: 2, signOuts: 0 });
  });
});

it('expiresAt lit la revendication exp, ou rend null', () => {
  expect(expiresAt(jwt('a', T0))).toBe(T0);
  for (const token of ['', 'abc', 'a.b.c', `a.${btoa('{"exp":"demain"}')}.c`])
    expect(expiresAt(token)).toBeNull();
});
