import { execSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';
import { serviceRoleUrl } from '@oikos/db';

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
// Les tests de bout en bout font avancer le temps de jeu directement en base.
process.env['DATABASE_URL'] = need('DB_URL');

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  // Service worker bloqué par défaut : une page qu'il contrôle peut échapper à `page.route`, et un
  // test qui simule une réponse perdue voit alors la vraie réponse. Seul le test d'installation le
  // laisse actif (`onboarding.spec.ts`).
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    locale: 'fr-FR',
    serviceWorkers: 'block',
  },
  // Définition de terminé : utilisable à 360 px (téléphone) comme à 1 440 px (ordinateur).
  projects: [
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } },
    },
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @oikos/api dev',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: !process.env['CI'],
      env: {
        // L'API tourne sous le rôle de service, comme en production.
        DATABASE_URL: serviceRoleUrl(need('DB_URL')),
        SUPABASE_URL: need('API_URL'),
        API_PORT: '8787',
      },
    },
    {
      // Construction de production servie en prévisualisation : c'est elle qui porte le service worker.
      command: 'pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env['CI'],
      env: {
        VITE_SUPABASE_URL: need('API_URL'),
        VITE_SUPABASE_PUBLISHABLE_KEY: need('PUBLISHABLE_KEY'),
      },
    },
  ],
});
