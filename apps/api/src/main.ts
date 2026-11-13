import { serve } from '@hono/node-server';
import { createConfigLoader, ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { createDb } from '@oikos/db';
import { createApp } from './app';
import { tokenVerifierFromEnv } from './auth';
import { createRateLimiter, rateLimitFromEnv } from './rate-limit';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const db = createDb(requireEnv('DATABASE_URL'));
// Premier démarrage : publie la configuration initiale (sans effet si une version existe déjà).
await ensureInitialConfig(db, INITIAL_CONFIG);
const app = createApp({
  db,
  loadConfig: createConfigLoader(db).at,
  verifyToken: tokenVerifierFromEnv(process.env),
  rateLimiter: createRateLimiter(rateLimitFromEnv(process.env)),
});
const port = Number(process.env['API_PORT'] ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`OIKOS API listening on :${port}`));
