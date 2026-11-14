import { ADMIN_MODULE_ROLES, type AdminRole, type CommandError } from '@oikos/contracts';
import type { Db } from '@oikos/db';
import type { Hono } from 'hono';
import { sql } from 'kysely';
import type { Identity, TokenVerifier } from './auth';
import type { RateLimiter } from './rate-limit';

type AdminEnv = { Variables: { identity: Identity; adminRole: AdminRole } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tailles de page (limites techniques). */
const RECENT_TICKS = 20;
const DEFAULT_AUDIT_PAGE = 50;
const MAX_AUDIT_PAGE = 100;

/**
 * Lectures du back-office (docs/specs/15-back-office-olympe.md) : le back-office n'accède jamais aux
 * tables, il lit par ces routes. Comme pour les commandes d'administration, la session doit porter le
 * second facteur et le compte un rôle, relu en base à chaque requête.
 */
export function registerAdminReads(
  app: Hono<AdminEnv>,
  deps: { db: Db; verifyToken: TokenVerifier; rateLimiter: RateLimiter },
  fail: (error: CommandError) => Response,
) {
  const { db, verifyToken, rateLimiter } = deps;
  const forbidden = () =>
    fail({ code: 'FORBIDDEN', message: 'Administrator role and two-factor session required.' });

  app.use('/api/admin/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const identity = token ? await verifyToken(token) : null;
    if (!identity) return fail({ code: 'UNAUTHENTICATED', message: 'Missing or invalid token.' });
    const quota = await rateLimiter.hit(`${identity.userId}:admin.read`);
    if (!quota.allowed) {
      const refused = fail({ code: 'RATE_LIMITED', message: 'Too many requests.' });
      refused.headers.set('Retry-After', String(quota.retryAfterSeconds));
      return refused;
    }
    if (identity.aal !== 'aal2') return forbidden();
    const row = await db
      .selectFrom('admin.roles')
      .select('role')
      .where('user_id', '=', identity.userId)
      .executeTakeFirst();
    if (!row) return forbidden();
    c.set('identity', identity);
    c.set('adminRole', row.role);
    return next();
  });
  // Chaque route appartient à un module, dont les rôles viennent de la liste partagée avec le client
  // (`ADMIN_MODULE_ROLES`) : une route ajoutée sans module n'est ouverte à personne.
  for (const [path, module] of [
    ['/api/admin/vigie', 'vigie'],
    ['/api/admin/config/*', 'config'],
    ['/api/admin/audit', 'audit'],
    ['/api/admin/roles', 'access'],
  ] as const) {
    const roles: readonly AdminRole[] = ADMIN_MODULE_ROLES[module];
    app.use(path, async (c, next) => {
      if (!roles.includes(c.get('adminRole'))) return forbidden();
      return next();
    });
  }
  // Tout autre chemin que ceux déclarés ici et `/me` est refusé, quel que soit le rôle.
  const OPEN_PATHS = ['/api/admin/me', '/api/admin/vigie', '/api/admin/audit', '/api/admin/roles'];
  app.use('/api/admin/*', async (c, next) => {
    const known = OPEN_PATHS.includes(c.req.path) || c.req.path.startsWith('/api/admin/config/');
    if (!known) return forbidden();
    return next();
  });
  const invalid = (field: string) =>
    fail({ code: 'VALIDATION_FAILED', message: 'Invalid query parameter.', fields: [field] });

  app.get('/api/admin/me', (c) => c.json({ ok: true, data: { role: c.get('adminRole') } }));

  // Accès : comptes qui portent un rôle, du plus ancien au plus récent. Identifiants seuls, aucune adresse :
  // comme les commandes de rôle, cette lecture ne touche pas aux comptes de Supabase Auth.
  app.get('/api/admin/roles', async (c) => {
    const roles = await db
      .selectFrom('admin.roles')
      .select(['user_id', 'role', 'granted_by', 'granted_at'])
      .orderBy('granted_at')
      .orderBy('user_id')
      .execute();
    return c.json({
      ok: true,
      data: {
        roles: roles.map((row) => ({
          userId: row.user_id,
          role: row.role,
          // `null` : premier super-administrateur, inscrit en base par un humain.
          grantedBy: row.granted_by,
          grantedAt: row.granted_at.toISOString(),
        })),
      },
    });
  });

  // Vigie : joueurs, commandes et ticks des dernières 24 heures.
  app.get('/api/admin/vigie', async (c) => {
    const totals = await sql<{
      houses: string;
      active_accounts: string;
      commands_ok: string;
      commands_rejected: string;
      commands_failed: string;
      ticks_failed: string;
      tick_max_ms: number | null;
    }>`
      select (select count(*) from game.houses) as houses,
             count(distinct l.user_id) as active_accounts,
             count(*) filter (where l.status = 'ok') as commands_ok,
             count(*) filter (where l.status = 'rejected') as commands_rejected,
             count(*) filter (where l.status = 'failed') as commands_failed,
             (select count(*) from telemetry.tick_runs
               where status = 'failed' and created_at > now() - interval '24 hours') as ticks_failed,
             (select max(duration_ms) from telemetry.tick_runs
               where created_at > now() - interval '24 hours') as tick_max_ms
      from game.command_log l where l.created_at > now() - interval '24 hours'`.execute(db);
    const ticks = await db
      .selectFrom('telemetry.tick_runs')
      .select(['world_id', 'tick_index', 'status', 'duration_ms', 'error', 'created_at'])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(RECENT_TICKS)
      .execute();
    // Refus avant exécution, comptés par heure : la fenêtre va de l'heure qui suit « il y a 24 heures »
    // à l'heure en cours (entre 23 et 24 heures). Lectures du back-office : 24 heures glissantes.
    const refusals = await sql<{ reason: string; n: string }>`
      select reason, sum(count)::text as n from telemetry.api_refusals
      where bucket > now() - interval '24 hours' and bucket <= now() group by reason`.execute(db);
    const refused = (reason: string) =>
      Number(refusals.rows.find((row) => row.reason === reason)?.n ?? 0);
    const reads = await sql<{ n: string }>`
      select count(*)::text as n from telemetry.admin_reads
      where created_at > now() - interval '24 hours'`.execute(db);
    // File de tâches du moteur (pg-boss) : absente tant que le moteur n'a jamais démarré sur cette base.
    const installed = await sql<{ present: boolean }>`
      select to_regclass('pgboss.job') is not null as present`.execute(db);
    // Une table d'une autre forme (autre version de pg-boss) ne doit pas faire tomber la Vigie.
    const queue = installed.rows[0]?.present
      ? await sql<{ pending: string }>`
          select count(*)::text as pending from pgboss.job
          where state::text in ('created', 'retry', 'active')`
          .execute(db)
          .then(
            (result) => result.rows[0]?.pending ?? null,
            () => null,
          )
      : null;
    const total = totals.rows[0];
    return c.json({
      ok: true,
      data: {
        houses: Number(total?.houses),
        activeAccounts24h: Number(total?.active_accounts),
        commands24h: {
          ok: Number(total?.commands_ok),
          rejected: Number(total?.commands_rejected),
          failed: Number(total?.commands_failed),
        },
        ticks24h: {
          failed: Number(total?.ticks_failed),
          maxDurationMs: total?.tick_max_ms ?? null,
        },
        recentTicks: ticks.map((tick) => ({
          worldId: tick.world_id,
          tickIndex: Number(tick.tick_index),
          status: tick.status,
          durationMs: tick.duration_ms,
          error: tick.error,
          createdAt: tick.created_at.toISOString(),
        })),
        queuePending: queue === null ? null : Number(queue),
        refusals24h: {
          unauthenticated: refused('unauthenticated'),
          payloadTooLarge: refused('payload_too_large'),
          rateLimited: refused('rate_limited'),
          forbidden: refused('forbidden'),
        },
        adminReads24h: Number(reads.rows[0]?.n),
      },
    });
  });

  // Paramètres : versions de configuration, activations programmées, version en vigueur.
  app.get('/api/admin/config/versions', async (c) => {
    const versions = await db
      .selectFrom('config.versions')
      .select(['id', 'number', 'note', 'created_by', 'created_at'])
      .orderBy('number', 'desc')
      .execute();
    const activations = await db
      .selectFrom('config.activations as a')
      .leftJoin('config.activation_cancellations as c', 'c.activation_id', 'a.id')
      .select(['a.id', 'a.version_id', 'a.activate_at', 'a.created_by', 'a.created_at'])
      .select(['c.cancelled_at', 'c.cancelled_by'])
      .orderBy('a.activate_at', 'desc')
      .orderBy('a.seq', 'desc')
      .execute();
    const active = await sql<{ id: string | null }>`
      select config.active_version_at(now()) as id`.execute(db);
    return c.json({
      ok: true,
      data: {
        activeVersionId: active.rows[0]?.id ?? null,
        versions: versions.map((version) => ({
          id: version.id,
          number: version.number,
          note: version.note,
          createdBy: version.created_by,
          createdAt: version.created_at.toISOString(),
        })),
        activations: activations.map((activation) => ({
          id: activation.id,
          versionId: activation.version_id,
          activateAt: activation.activate_at.toISOString(),
          createdBy: activation.created_by,
          createdAt: activation.created_at.toISOString(),
          // Programmation annulée : elle reste au journal, mais n'entrera pas en vigueur.
          cancelledAt: activation.cancelled_at?.toISOString() ?? null,
          cancelledBy: activation.cancelled_by,
        })),
      },
    });
  });

  app.get('/api/admin/config/versions/:id', async (c) => {
    const id = c.req.param('id');
    const version = UUID.test(id)
      ? await db
          .selectFrom('config.versions')
          .select(['id', 'number', 'note', 'payload'])
          .where('id', '=', id)
          .executeTakeFirst()
      : undefined;
    if (!version) {
      return fail({ code: 'CONFIG_VERSION_NOT_FOUND', message: 'Unknown configuration version.' });
    }
    const { payload, ...meta } = version;
    return c.json({ ok: true, data: { ...meta, config: payload } });
  });

  // Journal d'audit : toutes les commandes d'administration, réussies ou refusées, les plus récentes d'abord.
  // `before` : identifiant de la dernière entrée déjà lue.
  app.get('/api/admin/audit', async (c) => {
    // Paramètres validés avant toute requête : entier positif, identifiant d'entrée.
    const [rawLimit, before] = [c.req.query('limit'), c.req.query('before')];
    if (rawLimit !== undefined && !/^[1-9]\d{0,8}$/.test(rawLimit)) return invalid('limit');
    if (before !== undefined && !UUID.test(before)) return invalid('before');
    const limit = Math.min(Number(rawLimit ?? DEFAULT_AUDIT_PAGE), MAX_AUDIT_PAGE);
    // Tri et curseur sur l'identifiant (UUID v7, croissant dans le temps) : unique, donc aucune entrée
    // sautée ni répétée d'une page à l'autre, même écrites dans la même milliseconde.
    let query = db
      .selectFrom('game.command_log')
      .select([
        'id',
        'user_id',
        'command',
        'status',
        'error_code',
        'response',
        'aal',
        'admin_role',
        'config_version_id',
        'created_at',
      ])
      // Motif écrit en littéral, comme dans la définition de l'index partiel : le planificateur le
      // reconnaît même avec un plan générique.
      .where(sql<boolean>`command like 'admin.%'`)
      .orderBy('id', 'desc')
      .limit(limit);
    if (before) query = query.where('id', '<', before);
    const entries = await query.execute();
    return c.json({
      ok: true,
      data: {
        entries: entries.map((entry) => ({
          id: entry.id,
          userId: entry.user_id,
          command: entry.command,
          status: entry.status,
          errorCode: entry.error_code,
          // Résultat rendu à l'appelant (identifiant de version, échéance) ; jamais l'entrée complète.
          result: (entry.response as { data?: unknown }).data ?? null,
          // Contexte de la commande ; absent des lignes écrites avant qu'il soit journalisé.
          aal: entry.aal ?? null,
          adminRole: entry.admin_role ?? null,
          configVersionId: entry.config_version_id ?? null,
          createdAt: entry.created_at.toISOString(),
        })),
      },
    });
  });
}
