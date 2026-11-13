import { IDEMPOTENCY_HEADER, idempotencyKeySchema, type CommandError } from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { TokenVerifier } from './auth';
import { houseCreate } from './commands/house-create';
import { houseRename } from './commands/house-rename';
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
}

/** Registre des commandes servies par l'API. */
export const COMMANDS = [
  houseCreate,
  houseRename,
  siteCollect,
  marketPlaceOrder,
] as readonly CommandDefinition[];

const STATUS_BY_CODE: Record<string, ContentfulStatusCode> = {
  UNAUTHENTICATED: 401,
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  COMMAND_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};
/** Statut HTTP d'une erreur : table ci-dessus, 404 pour `*_NOT_FOUND`, 409 pour toute autre erreur métier. */
const statusOf = (code: string): ContentfulStatusCode =>
  STATUS_BY_CODE[code] ?? (code.endsWith('_NOT_FOUND') ? 404 : 409);

/** Taille maximale du corps d'une commande (limite technique, pas un paramètre d'équilibrage). */
const MAX_BODY_BYTES = 16 * 1024;

export function createApp({ db, verifyToken, rateLimiter, loadConfig }: AppDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();
  const fail = (error: CommandError) =>
    Response.json({ ok: false, error }, { status: statusOf(error.code) });

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Une commande est un petit objet JSON : au-delà, la requête est refusée avant lecture.
  app.use(
    '/api/commands/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () =>
        Response.json(
          { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Request body too large.' } },
          { status: 413 },
        ),
    }),
  );

  // Toute commande exige un jeton Supabase valide.
  app.use('/api/commands/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const userId = token ? await verifyToken(token) : null;
    if (!userId) return fail({ code: 'UNAUTHENTICATED', message: 'Missing or invalid token.' });
    c.set('userId', userId);
    return next();
  });

  // Toute commande passe par le registre : clé d'idempotence, transaction, journal, événements.
  const registry = new Map(COMMANDS.map((command) => [command.name, command]));
  app.post('/api/commands/:name', async (c) => {
    const command = registry.get(c.req.param('name'));
    if (!command) return fail({ code: 'COMMAND_NOT_FOUND', message: 'Unknown command.' });
    // Compté après l'authentification et pour une commande connue seulement : le nombre de compteurs
    // est borné par comptes × commandes du registre.
    const quota = rateLimiter.hit(`${c.get('userId')}:${command.name}`);
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
    const request = { userId: c.get('userId'), idempotencyKey: key.data, input };
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
