import { houseCreateInputSchema, type CommandError } from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { TokenVerifier } from './auth';
import { houseCreate } from './commands/house-create';

export interface AppDeps {
  db: Db;
  verifyToken: TokenVerifier;
}

const STATUS_BY_CODE: Record<string, ContentfulStatusCode> = {
  UNAUTHENTICATED: 401,
  VALIDATION_FAILED: 400,
  CITY_NOT_FOUND: 404,
  HOUSE_ALREADY_EXISTS: 409,
  HOUSE_NAME_TAKEN: 409,
  INTERNAL: 500,
};

export function createApp({ db, verifyToken }: AppDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();
  const fail = (error: CommandError) =>
    Response.json({ ok: false, error }, { status: STATUS_BY_CODE[error.code] ?? 400 });

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Toute commande exige un jeton Supabase valide.
  app.use('/api/commands/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const userId = token ? await verifyToken(token) : null;
    if (!userId) return fail({ code: 'UNAUTHENTICATED', message: 'Missing or invalid token.' });
    c.set('userId', userId);
    return next();
  });

  app.post('/api/commands/house.create', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = houseCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return fail({
        code: 'VALIDATION_FAILED',
        message: 'Invalid input.',
        fields: [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))],
      });
    }
    const result = await houseCreate(db, c.get('userId'), parsed.data);
    return result.ok ? c.json(result) : fail(result.error);
  });

  app.onError((error) => {
    console.error(error);
    return fail({ code: 'INTERNAL', message: 'Unexpected error.' });
  });

  return app;
}
