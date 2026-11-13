import { describe, expect, it } from 'vitest';
import { createRateLimiter, rateLimitFromEnv } from './rate-limit';

describe('limitation de débit', () => {
  it('laisse passer jusqu’à la limite, puis refuse en indiquant quand réessayer', () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 }, () => now);
    expect([1, 2, 3].map(() => limiter.hit('alice:house.rename').allowed)).toEqual([
      true,
      true,
      true,
    ]);
    expect(limiter.hit('alice:house.rename')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    now += 45_500;
    expect(limiter.hit('alice:house.rename')).toEqual({ allowed: false, retryAfterSeconds: 15 });
  });

  it('rouvre à la fenêtre suivante, et un refus ne prolonge pas l’attente', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 }, () => now);
    expect(limiter.hit('k').allowed).toBe(true);
    for (now = 100; now < 1000; now += 100) expect(limiter.hit('k').allowed).toBe(false);
    now = 1000;
    expect(limiter.hit('k').allowed).toBe(true);
  });

  it('compte séparément chaque compte et chaque commande', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 }, () => 0);
    expect(limiter.hit('alice:house.rename').allowed).toBe(true);
    expect(limiter.hit('alice:house.rename').allowed).toBe(false);
    expect(limiter.hit('bob:house.rename').allowed).toBe(true);
    expect(limiter.hit('alice:house.create').allowed).toBe(true);
  });

  it('purge les compteurs expirés une fois par fenêtre, sans jamais lever une limite en cours', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 }, () => now);
    for (const key of ['a', 'b', 'c']) limiter.hit(key);
    now = 900;
    expect(limiter.hit('saturé').allowed).toBe(true);
    expect(limiter.size()).toBe(4);
    // Nouvelle fenêtre pour a, b, c ; « saturé » est encore dans la sienne.
    now = 1100;
    expect(limiter.hit('d').allowed).toBe(true);
    expect(limiter.size()).toBe(2);
    expect(limiter.hit('saturé')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('lit le réglage dans l’environnement et refuse une valeur absurde au démarrage', () => {
    expect(rateLimitFromEnv({})).toEqual({ limit: 120, windowMs: 60_000 });
    expect(rateLimitFromEnv({ API_RATE_LIMIT_PER_MINUTE: '30' }).limit).toBe(30);
    for (const bad of [
      '0',
      '-5',
      '1.5',
      'beaucoup',
      '',
      ' 30',
      '1e3',
      '0x10',
      '+5',
      '1e21',
      '1000000',
    ]) {
      expect(() => rateLimitFromEnv({ API_RATE_LIMIT_PER_MINUTE: bad })).toThrow(
        /positive integer/,
      );
    }
  });
});
