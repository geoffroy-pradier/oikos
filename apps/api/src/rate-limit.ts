import type { Db } from '@oikos/db';
import { sql } from 'kysely';

/**
 * Limitation de débit par compte et par commande (docs/specs/13-moteur-anti-triche.md).
 * Fenêtre fixe. En production le compteur est tenu en base (`createSharedRateLimiter`) : toutes les
 * répliques de l'API comptent ensemble. Le compteur en mémoire sert de repli si la base ne répond pas,
 * et aux tests. Une rafale à cheval sur deux fenêtres peut atteindre deux fois la limite.
 */
export interface RateLimitSettings {
  /** Nombre maximal de commandes par fenêtre, pour un compte et une commande donnés. */
  limit: number;
  windowMs: number;
}

export type Quota = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Compte une tentative. `retryAfterSeconds` est renseigné quand elle est refusée. */
  hit(key: string): Quota | Promise<Quota>;
  /** Nombre de compteurs en mémoire (observation et tests). */
  size(): number;
}

/** Compteur en mémoire : répond sans attendre. */
export interface LocalRateLimiter extends RateLimiter {
  hit(key: string): Quota;
}

/** Aucune limite : pour les tests qui ne portent pas sur le débit. Jamais en production (`main.ts`). */
export const unlimited: RateLimiter = { hit: () => ({ allowed: true }), size: () => 0 };

export function createRateLimiter(
  { limit, windowMs }: RateLimitSettings,
  now: () => number = Date.now,
): LocalRateLimiter {
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

/**
 * Compteur tenu en base (`telemetry.rate_windows`) : une instruction par tentative, atomique, et la
 * même fenêtre pour toutes les répliques (l'heure est celle de la base). Si la base ne répond pas, la
 * tentative est comptée par le compteur en mémoire de cette réplique : la limite reste bornée.
 */
export function createSharedRateLimiter(
  db: Db,
  settings: RateLimitSettings,
  fallback: RateLimiter = createRateLimiter(settings),
): RateLimiter & { prune(): Promise<void> } {
  const { limit, windowMs } = settings;
  return {
    async hit(key) {
      try {
        const result = await sql<{ count: number; wait_ms: string }>`
          with slot as (
            select to_timestamp(floor(extract(epoch from clock_timestamp()) * 1000 / ${windowMs}) * ${windowMs} / 1000) as starts
          )
          insert into telemetry.rate_windows (key, window_start, count)
          select ${key}, starts, 1 from slot
          on conflict (key, window_start) do update set count = telemetry.rate_windows.count + 1
          returning count,
            (extract(epoch from window_start + ${windowMs} * interval '1 millisecond' - clock_timestamp()) * 1000)::bigint as wait_ms
        `.execute(db);
        const row = result.rows[0];
        if (!row) throw new Error('The rate window returned no row');
        if (row.count <= limit) return { allowed: true };
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(Number(row.wait_ms) / 1000)),
        };
      } catch (error) {
        console.error('Shared rate limit unavailable, counting in memory', error);
        return fallback.hit(key);
      }
    },
    size: () => fallback.size(),
    /** Retire les fenêtres closes depuis plus d'une heure. Ne lève jamais. */
    async prune() {
      await sql`select telemetry.prune_rate_windows()`
        .execute(db)
        .then(() => undefined)
        .catch((error: unknown) => console.error('Rate window pruning failed', error));
    },
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
