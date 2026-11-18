import { serve } from '@hono/node-server';
import { createConfigLoader, ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { createDb } from '@oikos/db';
import { createApp } from './app';
import { tokenVerifierFromEnv } from './auth';
import { SELF_REVIEW_ENV, selfReviewFromEnv } from './commands/admin-config';
import { createSharedRateLimiter, rateLimitFromEnv } from './rate-limit';
import { retryFromEnv } from './registry';
import { createTelemetry } from './telemetry';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const db = createDb(requireEnv('DATABASE_URL'));
// Premier démarrage : publie la configuration initiale (sans effet si une version existe déjà).
await ensureInitialConfig(db, INITIAL_CONFIG);
const telemetry = createTelemetry(db);
// Limite de débit tenue en base : les répliques de l'API comptent ensemble.
const rateLimiter = createSharedRateLimiter(db, rateLimitFromEnv(process.env));
const PRUNE_MS = 10 * 60_000;
setInterval(() => void rateLimiter.prune(), PRUNE_MS).unref();
// Compteurs de refus écrits par lots : la base ne voit pas une écriture par requête refusée.
const FLUSH_MS = 10_000;
setInterval(() => void telemetry.flush(), FLUSH_MS).unref();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void telemetry.flush().finally(() => process.exit(0)));
}
const allowSelfReview = selfReviewFromEnv(process.env);
if (allowSelfReview) {
  console.warn(`${SELF_REVIEW_ENV}=true: configuration versions can be scheduled by their author.`);
}
const app = createApp({
  db,
  settings: { allowSelfReview, retry: retryFromEnv(process.env) },
  telemetry,
  loadConfig: createConfigLoader(db).at,
  verifyToken: tokenVerifierFromEnv(process.env),
  rateLimiter,
});
const port = Number(process.env['API_PORT'] ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`OIKOS API listening on :${port}`));
