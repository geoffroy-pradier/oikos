import { ConfigError, DEFAULT_MODERATION, databaseKnowsTimezone } from '@oikos/config';
import {
  ADMIN_MODULE_ROLES,
  adminEventsDataSchema,
  type AdminEventsData,
  type AdminRole,
  type CommandError,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import type { Hono } from 'hono';
import { sql } from 'kysely';
import { readAiUsage } from './admin-ai';
import { readEconomy } from './admin-economy';
import {
  commonIds,
  configIds,
  NO_IDS,
  readWorldUsage,
  retiredUsage,
  splitByInForce,
  versionConfigIds,
} from './config-usage';
import type { Identity, TokenVerifier } from './auth';
import type { RateLimiter } from './rate-limit';
import { DEFAULT_SETTINGS, type ApiSettings, type ConfigSource } from './registry';

type AdminEnv = { Variables: { identity: Identity; adminRole: AdminRole } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tailles de page (limites techniques). */
const RECENT_TICKS = 20;
const DEFAULT_AUDIT_PAGE = 50;
const MAX_AUDIT_PAGE = 100;
const DEFAULT_ECONOMY_DAYS = 30;
const MAX_ECONOMY_DAYS = 90;
/** Calendrier des événements : finis depuis au plus 30 jours, et au plus 1 000 lignes. */
const EVENTS_PAST_MS = 30 * 86_400_000;
const MAX_EVENTS = 1_000;
/** File de la modération : messages de contexte de chaque côté d'un message signalé, entrées au plus. */
const REPORT_CONTEXT_MESSAGES = 5;
const MAX_REPORT_ENTRIES = 200;

/**
 * Lectures du back-office (docs/specs/15-back-office-olympe.md) : le back-office n'accède jamais aux
 * tables, il lit par ces routes. Comme pour les commandes d'administration, la session doit porter le
 * second facteur et le compte un rôle, relu en base à chaque requête.
 */
export function registerAdminReads(
  app: Hono<AdminEnv>,
  deps: {
    db: Db;
    verifyToken: TokenVerifier;
    rateLimiter: RateLimiter;
    loadConfig: ConfigSource;
    settings?: ApiSettings | undefined;
  },
  fail: (error: CommandError) => Response,
) {
  const { db, verifyToken, rateLimiter, loadConfig, settings = DEFAULT_SETTINGS } = deps;
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
    ['/api/admin/economy', 'economy'],
    ['/api/admin/config/*', 'config'],
    ['/api/admin/audit', 'audit'],
    ['/api/admin/roles', 'access'],
    ['/api/admin/events', 'animation'],
    ['/api/admin/reports', 'moderation'],
  ] as const) {
    const roles: readonly AdminRole[] = ADMIN_MODULE_ROLES[module];
    app.use(path, async (c, next) => {
      if (!roles.includes(c.get('adminRole'))) return forbidden();
      return next();
    });
  }
  // Tout autre chemin que ceux déclarés ici et `/me` est refusé, quel que soit le rôle.
  const OPEN_PATHS = ['me', 'vigie', 'economy', 'audit', 'roles', 'events', 'reports'].map(
    (name) => `/api/admin/${name}`,
  );
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

  // Vigie : joueurs, commandes, ticks et clôtures des dernières 24 heures. Une opération d'intendant, journalisée au
  // nom du compte avec l'intendant pour acteur (`steward_id`), est comptée à part et ne rend pas le compte actif (#563).
  app.get('/api/admin/vigie', async (c) => {
    const totals = await sql<{
      worlds: string;
      houses: string;
      active_accounts: string;
      commands_ok: string;
      commands_rejected: string;
      commands_failed: string;
      steward_ok: string;
      steward_rejected: string;
      steward_failed: string;
      ticks_failed: string;
      tick_max_ms: number | null;
      closes_failed: string;
      close_last_error: string | null;
    }>`
      select (select count(*) from game.worlds) as worlds,
             (select count(*) from game.houses) as houses,
             count(distinct l.user_id) filter (where l.steward_id is null) as active_accounts,
             count(*) filter (where l.status = 'ok' and l.steward_id is null) as commands_ok,
             count(*) filter (where l.status = 'rejected' and l.steward_id is null) as commands_rejected,
             count(*) filter (where l.status = 'failed' and l.steward_id is null) as commands_failed,
             count(*) filter (where l.status = 'ok' and l.steward_id is not null) as steward_ok,
             count(*) filter (where l.status = 'rejected' and l.steward_id is not null) as steward_rejected,
             count(*) filter (where l.status = 'failed' and l.steward_id is not null) as steward_failed,
             (select count(*) from telemetry.tick_runs
               where status = 'failed' and created_at > now() - interval '24 hours') as ticks_failed,
             (select max(duration_ms) from telemetry.tick_runs
               where created_at > now() - interval '24 hours') as tick_max_ms,
             (select count(*) from telemetry.close_runs
               where status = 'failed' and created_at > now() - interval '24 hours') as closes_failed,
             (select error from telemetry.close_runs
               where status = 'failed' and created_at > now() - interval '24 hours'
               order by created_at desc, id desc limit 1) as close_last_error
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
    // Horloge (3) : la configuration est globale, son fuseau en vigueur vaut pour tous les mondes. Un
    // fuseau sorti de la base des fuseaux n'est pas refusé à la publication (version en vigueur), mais
    // `game.clock_rules()` le rend nul : les comptes de tous les mondes perdent jour de jeu et saison.
    // Le chargeur refuse (`ConfigError`) une base sans version en vigueur (`clock: null`) comme une version
    // en vigueur hors du schéma : celle-ci est dite telle, et son fuseau lu brut, comme le fait
    // `game.clock_rules()` (nul s'il n'est pas une chaîne). La Vigie ne tombe dans aucun des deux cas.
    const inForce = await loadConfig(new Date()).then(
      (loaded) => ({
        timezone: loaded.config.clock.timezone as string | null,
        invalidConfig: false,
      }),
      async (error: unknown) => {
        if (!(error instanceof ConfigError)) throw error;
        const row = await db
          .selectFrom('config.versions as v')
          .select(
            sql<string | null>`case when jsonb_typeof(v.payload #> '{clock,timezone}') = 'string'
              then v.payload #>> '{clock,timezone}' end`.as('timezone'),
          )
          .where('v.id', '=', sql<string>`config.active_version_at(now())`)
          .executeTakeFirst();
        return row ? { timezone: row.timezone, invalidConfig: true } : null;
      },
    );
    // Passerelle IA (ADR 0005) : nul sans configuration en vigueur lisible, comme l'horloge.
    const now = new Date();
    const ai = await loadConfig(now).then(
      (loaded) => readAiUsage(db, loaded.config.ai, now),
      (error: unknown) => {
        if (error instanceof ConfigError) return null;
        throw error;
      },
    );
    // Voyages en retard de déchargement (4.6, #253) : encore en mer alors que le tick qui devait les
    // décharger, le premier qui commence à leur échéance ou après, est terminé. Tous mondes confondus ;
    // nul sans configuration en vigueur lisible, comme l'horloge.
    const voyagesOverdue = await loadConfig(now).then(
      async (loaded) => {
        const tick = loaded.config.clock.tickMinutes * 60;
        const { rows } = await sql<{ n: string }>`
          select count(*)::text as n from game.voyages
          where arrived_at is null and arrives_at <= now() - ${tick}::int * interval '1 second'
            and ceil(extract(epoch from arrives_at) / ${tick}::int) * ${tick}::int + ${tick}::int
              <= extract(epoch from now())`.execute(db);
        return Number(rows[0]?.n);
      },
      (error: unknown) => {
        if (error instanceof ConfigError) return null;
        throw error;
      },
    );
    // Signalements ouverts depuis plus que le seuil de la configuration (15.5) ; nul sans configuration lisible.
    const staleReports = await loadConfig(now).then(
      async (loaded) => {
        const hours = loaded.config.moderation.staleReportHours;
        const { rows } = await sql<{ n: string; oldest: string | null }>`
          select count(*)::text as n,
                 floor(extract(epoch from now() - min(created_at)) / 3600)::text as oldest
          from game.reports
          where state = 'open' and created_at < now() - ${hours}::int * interval '1 hour'`.execute(
          db,
        );
        return {
          afterHours: hours,
          count: Number(rows[0]?.n),
          oldestHours: rows[0]?.oldest == null ? null : Number(rows[0].oldest),
        };
      },
      (error: unknown) => {
        if (error instanceof ConfigError) return null;
        throw error;
      },
    );
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
        // Champ ajouté : l'Olympe précédent l'ignore.
        stewardOperations24h: {
          ok: Number(total?.steward_ok),
          rejected: Number(total?.steward_rejected),
          failed: Number(total?.steward_failed),
        },
        ticks24h: {
          failed: Number(total?.ticks_failed),
          maxDurationMs: total?.tick_max_ms ?? null,
        },
        voyagesOverdue,
        staleReports,
        // Une clôture en échec (une maison en erreur annule celle de tout son monde) : comptée, et la
        // dernière erreur, qui nomme l'étape et la maison, affichée.
        closes24h: {
          failed: Number(total?.closes_failed),
          lastError: total?.close_last_error ?? null,
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
        // Même fuseau pour tous les mondes (`worlds` : leur nombre) ; `knownToDatabase` comme à la
        // publication (`pg_timezone_names`, casse ignorée).
        // `invalidConfig` : version en vigueur hors du schéma, que l'API et le moteur ne chargent pas ;
        // `timezone` et `knownToDatabase` sont alors nuls si son fuseau n'est pas une chaîne.
        clock:
          inForce === null
            ? null
            : {
                timezone: inForce.timezone,
                knownToDatabase:
                  inForce.timezone === null
                    ? null
                    : await databaseKnowsTimezone(db, inForce.timezone),
                worlds: Number(total?.worlds),
                invalidConfig: inForce.invalidConfig,
              },
        // Réglage de l'API pour un monde de test (15.4) : visible, pour qu'il ne reste pas actif par oubli.
        selfReviewAllowed: settings.allowSelfReview,
        ai,
      },
    });
  });

  // Économie : masse monétaire, robinets et puits (5.5). `days` : jours de jeu détaillés, jour en cours
  // compris (tout entier positif, borné au maximum), comptés avec l'horloge de la configuration en vigueur.
  app.get('/api/admin/economy', async (c) => {
    const rawDays = c.req.query('days');
    if (rawDays !== undefined && !/^[1-9]\d*$/.test(rawDays)) return invalid('days');
    const days = Math.min(Number(rawDays ?? DEFAULT_ECONOMY_DAYS), MAX_ECONOMY_DAYS);
    const { config } = await loadConfig(new Date());
    return c.json({ ok: true, data: await readEconomy(db, config, days) });
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
    // Un seul instant, celui de la base, pour la version signalée en vigueur et pour celle chargée plus bas.
    const active = await sql<{ id: string | null; now: Date }>`
      select config.active_version_at(now()) as id, now() as now`.execute(db);
    // Ce que chaque version retirerait de ce que le monde porte encore : dit avant la programmation (#191,
    // #200). La base ne lit que ce qu'une version au moins retire, réparti ensuite version par version.
    const ids = await versionConfigIds(db);
    const usage = await readWorldUsage(db, commonIds([...ids.values()]));
    // Rachat possible (#229) : un bien retiré encore détenu que la configuration en vigueur connaît, au
    // prix de référence en vigueur. Mêmes totaux que ceux que `admin.buyBackGood` recompte et compare.
    // Sans configuration en vigueur lisible (`ConfigError`), aucun rachat n'est proposé : la commande, qui
    // la charge aussi, n'en ferait aucun. Au-delà des entiers sûrs non plus : elle refuserait d'arrondir.
    // Même configuration en vigueur que celle que la commande charge : une recette ou une classe qu'elle
    // ne connaît déjà plus n'est pas à confirmer (#234). Illisible, tout est tenu pour retiré.
    const inForce = await loadConfig(active.rows[0]?.now ?? new Date()).then(
      (loaded) => loaded.config,
      (error: unknown) => {
        if (error instanceof ConfigError) return null;
        throw error;
      },
    );
    const goods = inForce?.goods ?? [];
    const inForceIds = inForce && configIds(inForce);
    const buybacks = usage.goods.flatMap(({ goodId, houses, quantity: units, openOrders }) => {
      const unitPriceOboles = goods.find((good) => good.id === goodId)?.referencePriceOboles;
      if (unitPriceOboles === undefined) return [];
      const oboles = units * unitPriceOboles;
      if (!Number.isSafeInteger(units) || !Number.isSafeInteger(oboles)) return [];
      return [
        { goodId, unitPriceOboles, totals: { houses, units, cancelledOrders: openOrders, oboles } },
      ];
    });
    return c.json({
      ok: true,
      data: {
        activeVersionId: active.rows[0]?.id ?? null,
        buybacks,
        versions: versions.map((version) => ({
          id: version.id,
          number: version.number,
          note: version.note,
          createdBy: version.created_by,
          createdAt: version.created_at.toISOString(),
          ...splitByInForce(retiredUsage(usage, ids.get(version.id) ?? NO_IDS), inForceIds),
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

  // Calendrier des événements du monde (7.3, 7.4 ; #267), tous mondes : ceux à venir, que les joueurs ne lisent
  // pas encore, et ceux en cours ou finis depuis `EVENTS_PAST_MS`, à l'heure de la base, sans leur graine. Les plus
  // tardifs d'abord : la limite coupe les plus anciens, jamais ceux à venir. Une ligne de plus que la limite est
  // lue pour savoir si la liste est coupée (#446) ; l'index sur la fin des événements sert cette lecture.
  app.get('/api/admin/events', async (c) => {
    const maxEvents = settings.maxAdminEvents ?? MAX_EVENTS;
    const { rows } = await sql<{ now: Date }>`select now() as now`.execute(db);
    const now = rows[0]?.now ?? new Date();
    const events = await db
      .selectFrom('game.world_events as e')
      .innerJoin('game.worlds as w', 'w.id', 'e.world_id')
      .innerJoin('game.cities as c', 'c.id', 'e.city_id')
      .leftJoin('game.cities as o', 'o.id', 'e.other_city_id')
      .select([
        'e.id',
        'w.slug as world',
        'e.model',
        'c.slug as city',
        'o.slug as otherCity',
        'e.good_id as goodId',
        'e.starts_at as startsAt',
        'e.ends_at as endsAt',
        'e.magnitude_bps as magnitudeBps',
        'e.planned_day as plannedDay',
      ])
      .where('e.ends_at', '>', new Date(now.getTime() - EVENTS_PAST_MS))
      .orderBy('e.starts_at', 'desc')
      .orderBy('e.id', 'desc')
      .limit(maxEvents + 1)
      .execute();
    return c.json({ ok: true, data: adminEventsData(now, events, maxEvents) });
  });

  // File de la modération (#276) : signalements ouverts et leur contexte, appels à trancher, exclusions à valider,
  // levées à confirmer (#616).
  // La base la compose (`admin.moderation_queue`, migration 261) et n'y met aucune donnée économique.
  app.get('/api/admin/reports', async (c) => {
    const { rows } = await sql<{ now: Date; queue: Record<string, unknown> }>`
      select now() as now,
             admin.moderation_queue(${REPORT_CONTEXT_MESSAGES}::int, ${MAX_REPORT_ENTRIES}::int) as queue`.execute(
      db,
    );
    const [row] = rows;
    if (!row) throw new Error('The database returned no moderation queue');
    // Levées proposées d'exclusions validées, à confirmer par une seconde personne (#616) : pas celles dont l'appel
    // attend, qui se lèvent en l'accueillant.
    const lifts = await db
      .selectFrom('admin.sanctions')
      .select([
        'id',
        'user_id',
        'reason',
        'author_id',
        'validated_by',
        'starts_at',
        'lift_proposed_by',
        'lift_proposed_at',
      ])
      .where('kind', '=', 'ban')
      .where('validated_by', 'is not', null)
      .where('lift_proposed_by', 'is not', null)
      .where('lifted_at', 'is', null)
      .where((eb) => eb.or([eb('appeal_body', 'is', null), eb('appeal_decision', 'is not', null)]))
      .orderBy('lift_proposed_at')
      .orderBy('id')
      .limit(MAX_REPORT_ENTRIES)
      .execute();
    // Sans configuration en vigueur lisible, la file reste lisible avec le seuil par défaut de la configuration.
    const moderation = await loadConfig(row.now).then(
      ({ config }) => config.moderation,
      (error: unknown) => {
        if (error instanceof ConfigError) return null;
        throw error;
      },
    );
    const data = {
      now: row.now.toISOString(),
      contextSize: REPORT_CONTEXT_MESSAGES,
      staleAfterHours: moderation?.staleReportHours ?? DEFAULT_MODERATION.staleReportHours,
      // Durées de `admin.sanction` (#541), et rien d'autre de la configuration : nulles sans version en vigueur
      // lisible, sans laquelle aucune commande ne passe. Champ ajouté : l'Olympe précédent ne valide pas la
      // réponse et l'ignore.
      sanctionHours: moderation && {
        warning: moderation.sanctionHours.warning,
        silence: moderation.sanctionHours.silence,
        suspension: moderation.sanctionHours.suspension,
      },
      ...row.queue,
      // Champ ajouté (#616) : l'Olympe précédent ne valide pas la réponse et l'ignore.
      pendingLifts: lifts.map((lift) => ({
        sanctionId: lift.id,
        userId: lift.user_id,
        reason: lift.reason,
        authorId: lift.author_id,
        confirmedBy: lift.validated_by,
        startsAt: lift.starts_at.toISOString(),
        proposedBy: lift.lift_proposed_by,
        proposedAt: lift.lift_proposed_at?.toISOString(),
      })),
    };
    return c.json({ ok: true, data });
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

/**
 * Réponse du calendrier des événements (#267, #446) : les `max` premières lignes lues, et si la lecture en
 * a trouvé davantage. Le schéma partagé choisit les champs rendus ; les instants partent en ISO 8601.
 */
export function adminEventsData(
  now: Date,
  rows: readonly (Record<string, unknown> & { startsAt: Date; endsAt: Date })[],
  max = MAX_EVENTS,
): AdminEventsData {
  return adminEventsDataSchema.parse({
    now: now.toISOString(),
    pastDays: EVENTS_PAST_MS / 86_400_000,
    events: rows.slice(0, max).map((row) => ({
      ...row,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    })),
    truncated: rows.length > max,
  });
}
