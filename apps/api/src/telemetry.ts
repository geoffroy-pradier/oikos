import type { Db } from '@oikos/db';
import { sql } from 'kysely';

export type RefusalKind = 'command' | 'admin_read';
export type RefusalReason = 'unauthenticated' | 'payload_too_large' | 'rate_limited' | 'forbidden';

export interface AdminRead {
  userId: string;
  adminRole: string;
  /** Gabarit de la route (identifiants remplacés), jamais l'adresse complète. */
  route: string;
  status: number;
}

/**
 * Ce que le journal des commandes ne voit pas (docs/specs/13-moteur-anti-triche.md) : refus avant
 * exécution et lectures du back-office.
 */
export interface Telemetry {
  /** Compte un refus. Ne touche pas à la base : un flot de requêtes refusées n'y écrit rien de plus. */
  refusal(kind: RefusalKind, reason: RefusalReason): void;
  /** Trace une lecture du back-office par un compte admis. Ne lève jamais. */
  adminRead(read: AdminRead): Promise<void>;
  /** Écrit les compteurs accumulés (appelé à intervalle régulier, et à l'arrêt). Ne lève jamais. */
  flush(): Promise<void>;
}

/**
 * Les refus sont accumulés en mémoire puis écrits par lots : le nombre d'écritures ne dépend pas du
 * nombre de requêtes refusées, seulement des heures, natures et raisons distinctes (16 lignes par heure
 * au plus). Un arrêt brutal perd au plus l'intervalle en cours.
 */
export function createTelemetry(db: Db, now: () => Date = () => new Date()): Telemetry {
  let pending = new Map<string, number>();
  const hourOf = (instant: Date) => new Date(Math.floor(instant.getTime() / 3_600_000) * 3_600_000);
  return {
    refusal(kind, reason) {
      const key = `${hourOf(now()).toISOString()}|${kind}|${reason}`;
      pending.set(key, (pending.get(key) ?? 0) + 1);
    },
    async adminRead({ userId, adminRole, route, status }) {
      await db
        .insertInto('telemetry.admin_reads')
        .values({ user_id: userId, admin_role: adminRole, route, status })
        .execute()
        .catch((error: unknown) => console.error('Admin read trace failed', error));
    },
    async flush() {
      const batch = pending;
      pending = new Map();
      for (const [key, count] of batch) {
        const [bucket, kind, reason] = key.split('|') as [string, RefusalKind, RefusalReason];
        try {
          await sql`insert into telemetry.api_refusals (bucket, kind, reason, count)
            values (${bucket}, ${kind}, ${reason}, ${count})
            on conflict (bucket, kind, reason) do update
              set count = telemetry.api_refusals.count + excluded.count`.execute(db);
        } catch (error) {
          // Remis en attente : le prochain passage réessaiera.
          pending.set(key, (pending.get(key) ?? 0) + count);
          console.error('Refusal counters write failed', error);
        }
      }
    },
  };
}

/**
 * Gabarit d'une route d'administration : tout identifiant est remplacé, les paramètres sont ignorés.
 * Un chemin qui ne ressemble à aucune route (trop long, caractères inattendus) n'est pas recopié.
 */
export function adminRouteTemplate(path: string): string {
  const template = path
    .split('/')
    .map((segment) => (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment) ? ':id' : segment))
    .join('/');
  return /^\/api\/admin\/[a-z0-9/:_-]{1,80}$/.test(template) ? template : '/api/admin/:unknown';
}
