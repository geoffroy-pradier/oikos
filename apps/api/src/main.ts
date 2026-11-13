import { serve } from '@hono/node-server';
import { createDb } from '@oikos/db';
import { createApp } from './app';
import { tokenVerifierFromEnv } from './auth';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const app = createApp({
  db: createDb(requireEnv('DATABASE_URL')),
  verifyToken: tokenVerifierFromEnv(process.env),
});
const port = Number(process.env['API_PORT'] ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`OIKOS API listening on :${port}`));
