/**
 * Limitation de débit par compte et par commande (docs/specs/13-moteur-anti-triche.md).
 * Fenêtre fixe, en mémoire : chaque instance de l'API compte pour elle-même. Avec deux instances, la
 * limite effective est donc au plus doublée ; un compteur partagé viendra si l'abus le justifie.
 * Une rafale à cheval sur deux fenêtres peut atteindre deux fois la limite par instance.
 */
export interface RateLimitSettings {
  /** Nombre maximal de commandes par fenêtre, pour un compte et une commande donnés. */
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  /** Compte une tentative. `retryAfterSeconds` est renseigné quand elle est refusée. */
  hit(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number };
  /** Nombre de compteurs en mémoire (observation et tests). */
  size(): number;
}

/** Aucune limite : pour les tests qui ne portent pas sur le débit. Jamais en production (`main.ts`). */
export const unlimited: RateLimiter = { hit: () => ({ allowed: true }), size: () => 0 };

export function createRateLimiter(
  { limit, windowMs }: RateLimitSettings,
  now: () => number = Date.now,
): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();
  let prunedAt = now();
  return {
    hit(key) {
      const time = now();
      // Une fois par fenêtre, les compteurs expirés sont retirés : la mémoire reste bornée par le nombre
      // de couples compte-commande actifs, et le coût de la purge est amorti.
      if (time - prunedAt >= windowMs) {
        for (const [other, value] of windows)
          if (time - value.startedAt >= windowMs) windows.delete(other);
        prunedAt = time;
      }
      let current = windows.get(key);
      if (!current || time - current.startedAt >= windowMs) {
        current = { startedAt: time, count: 0 };
        windows.set(key, current);
      }
      if (current.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + windowMs - time) / 1000)),
        };
      }
      current.count += 1;
      return { allowed: true };
    },
    size: () => windows.size,
  };
}

/** Réglage lu dans l'environnement : `API_RATE_LIMIT_PER_MINUTE` (défaut 120), par compte et par commande. */
export function rateLimitFromEnv(env: Record<string, string | undefined>): RateLimitSettings {
  const raw = env['API_RATE_LIMIT_PER_MINUTE'] ?? '120';
  const perMinute = /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(perMinute)) {
    throw new Error('API_RATE_LIMIT_PER_MINUTE must be a positive integer');
  }
  return { limit: perMinute, windowMs: 60_000 };
}
