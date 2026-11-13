import { execSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// Les adresses et clés de Supabase local sont lues à l'exécution : rien n'est écrit dans le dépôt.
const status = JSON.parse(
  execSync('pnpm exec supabase status --output json --workdir ../../packages/db', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
) as Record<string, string>;
const need = (key: string) => {
  const value = status[key];
  if (!value) throw new Error(`Supabase local : ${key} introuvable. Lancer \`pnpm db:start\`.`);
  return value;
};
process.env['MAILPIT_URL'] = need('MAILPIT_URL');

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'off', locale: 'fr-FR' },
  projects: [
    // Le parcours doit rester utilisable à 360 px de large (définition de terminé).
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @oikos/api dev',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: !process.env['CI'],
      env: {
        DATABASE_URL: need('DB_URL'),
        SUPABASE_URL: need('API_URL'),
        API_PORT: '8787',
      },
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env['CI'],
      env: {
        VITE_SUPABASE_URL: need('API_URL'),
        VITE_SUPABASE_PUBLISHABLE_KEY: need('PUBLISHABLE_KEY'),
      },
    },
  ],
});
