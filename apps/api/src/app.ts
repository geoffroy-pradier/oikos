import {
  IDEMPOTENCY_HEADER,
  idempotencyKeySchema,
  type AdminRole,
  type CommandError,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { registerAdminReads } from './admin-read';
import { adminRouteTemplate, type RefusalReason, type Telemetry } from './telemetry';
import type { Identity, TokenVerifier } from './auth';
import { adminPublishConfig, adminScheduleConfig } from './commands/admin-config';
import { houseCreate } from './commands/house-create';
import { houseRename } from './commands/house-rename';
import { marketCancelOrder } from './commands/market-cancel-order';
import { marketPlaceOrder } from './commands/market-place-order';
import { siteCollect } from './commands/site-collect';
import type { RateLimiter } from './rate-limit';
import { executeCommand, type CommandDefinition, type ConfigSource } from './registry';

export interface AppDeps {
  db: Db;
  verifyToken: TokenVerifier;
  /** Limitation de débit par compte et par commande. Obligatoire : l'oublier ne doit pas la désactiver. */
  rateLimiter: RateLimiter;
  /** Configuration de jeu active, fournie à chaque commande. */
  loadConfig: ConfigSource;
  /** Refus avant exécution et lectures du back-office. Obligatoire, pour la même raison. */
  telemetry: Telemetry;
}

/** Registre des commandes servies par l'API. */
export const COMMANDS = [
  houseCreate,
  houseRename,
  siteCollect,
  marketPlaceOrder,
  marketCancelOrder,
  adminPublishConfig,
  adminScheduleConfig,
] as readonly CommandDefinition[];

const STATUS_BY_CODE: Record<string, ContentfulStatusCode> = {
  UNAUTHENTICATED: 401,
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  COMMAND_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  FORBIDDEN: 403,
  INTERNAL: 500,
};
/** Statut HTTP d'une erreur : table ci-dessus, 404 pour `*_NOT_FOUND`, 409 pour toute autre erreur métier. */
const statusOf = (code: string): ContentfulStatusCode =>
  STATUS_BY_CODE[code] ?? (code.endsWith('_NOT_FOUND') ? 404 : 409);

/** Taille maximale du corps d'une commande (limite technique, pas un paramètre d'équilibrage). */
const MAX_BODY_BYTES = 16 * 1024;
/**
 * Une commande d'administration porte une configuration complète : 6 Ko pour les 15 biens du départ,
 * mais le catalogue visé en compte 60, avec leurs recettes. Marge prise pour ne pas y revenir.
 */
const MAX_ADMIN_BODY_BYTES = 128 * 1024;

/** Refus qui n'atteignent jamais le journal des commandes, par statut HTTP. */
const REFUSAL_BY_STATUS: Record<number, RefusalReason> = {
  401: 'unauthenticated',
  413: 'payload_too_large',
  429: 'rate_limited',
};

export function createApp({ db, verifyToken, rateLimiter, loadConfig, telemetry }: AppDeps) {
  const app = new Hono<{ Variables: { identity: Identity; adminRole: AdminRole } }>();
  const fail = (error: CommandError) =>
    Response.json({ ok: false, error }, { status: statusOf(error.code) });

  // Avant tout le reste : ce qui est refusé en amont est compté, les lectures admises sont tracées.
  app.use('/api/*', async (c, next) => {
    await next();
    const adminRead = c.req.path === '/api/admin' || c.req.path.startsWith('/api/admin/');
    const status = c.res.status;
    const reason = REFUSAL_BY_STATUS[status] ?? (adminRead && status === 403 ? 'forbidden' : null);
    if (reason) telemetry.refusal(adminRead ? 'admin_read' : 'command', reason);
    // Compte admis (second facteur et rôle relus) : la lecture est tracée, quelle que soit son issue.
    const [identity, adminRole] = [c.get('identity'), c.get('adminRole')];
    if (adminRead && identity && adminRole) {
      await telemetry.adminRead({
        userId: identity.userId,
        adminRole,
        route: adminRouteTemplate(c.req.path),
        status,
      });
    }
  });

  app.get('/api/health', (c) => c.json({ ok: true }));
  registerAdminReads(app, { db, verifyToken, rateLimiter }, fail);

  // Une commande est un petit objet JSON : au-delà, la requête est refusée avant lecture.
  const limit = (maxSize: number) =>
    bodyLimit({
      maxSize,
      onError: () =>
        Response.json(
          { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Request body too large.' } },
          { status: 413 },
        ),
    });
  const [gameLimit, adminLimit] = [limit(MAX_BODY_BYTES), limit(MAX_ADMIN_BODY_BYTES)];
  app.use('/api/commands/:name', (c, next) =>
    (c.req.param('name').startsWith('admin.') ? adminLimit : gameLimit)(c, next),
  );

  // Toute commande exige un jeton Supabase valide.
  app.use('/api/commands/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const identity = token ? await verifyToken(token) : null;
    if (!identity) return fail({ code: 'UNAUTHENTICATED', message: 'Missing or invalid token.' });
    c.set('identity', identity);
    return next();
  });

  // Toute commande passe par le registre : clé d'idempotence, transaction, journal, événements.
  const registry = new Map(COMMANDS.map((command) => [command.name, command]));
  app.post('/api/commands/:name', async (c) => {
    const command = registry.get(c.req.param('name'));
    if (!command) return fail({ code: 'COMMAND_NOT_FOUND', message: 'Unknown command.' });
    // Compté après l'authentification et pour une commande connue seulement : le nombre de compteurs
    // est borné par comptes × commandes du registre.
    const quota = rateLimiter.hit(`${c.get('identity').userId}:${command.name}`);
    if (!quota.allowed) {
      c.header('Retry-After', String(quota.retryAfterSeconds));
      return c.json(
        { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many commands.' } },
        429,
      );
    }
    const key = idempotencyKeySchema.safeParse(c.req.header(IDEMPOTENCY_HEADER));
    if (!key.success) {
      return fail({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: `Missing or malformed ${IDEMPOTENCY_HEADER} header.`,
      });
    }
    const input: unknown = await c.req.json().catch(() => null);
    const request = { ...c.get('identity'), idempotencyKey: key.data, input };
    const { response, replayed } = await executeCommand(db, command, request, loadConfig);
    c.header('Idempotent-Replay', String(replayed));
    return c.json(response, response.ok ? 200 : statusOf(response.error.code));
  });

  app.onError((error) => {
    console.error(error);
    return fail({ code: 'INTERNAL', message: 'Unexpected error.' });
  });

  return app;
}
