import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
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
// Les tests accordent les rôles d'administration directement en base, comme le ferait un humain.
process.env['DATABASE_URL'] = need('DB_URL');

/**
 * Navigateur du contrôle visuel (#700, `e2e/visual.spec.ts`) : le Chromium de l'image Docker officielle de
 * Playwright, à la version du dépôt, joint par `run-server` sur le réseau de l'hôte (Linux). Les images de
 * référence sont ainsi produites et comparées dans le même environnement de rendu (polices du système, réglages
 * de fontconfig), en local comme en `ci` ; le navigateur de l'hôte rend le texte autrement d'une machine à l'autre.
 */
const resolve = createRequire(import.meta.url).resolve;
const playwrightTest = resolve('@playwright/test/package.json');
const playwrightCore = dirname(
  createRequire(createRequire(playwrightTest).resolve('playwright/package.json')).resolve(
    'playwright-core/package.json',
  ),
);
const playwrightVersion = (JSON.parse(readFileSync(playwrightTest, 'utf8')) as { version: string })
  .version;
const VISUAL_PORT = 3124;
process.env['OIKOS_VISUAL_BROWSER'] = `ws://127.0.0.1:${VISUAL_PORT}/`;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  // Contrôle visuel (#700) : tolérance faible ; animations et curseur figés par Playwright.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled', caret: 'hide' } },
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'off', locale: 'fr-FR' },
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
      command: 'pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: !process.env['CI'],
      env: {
        VITE_SUPABASE_URL: need('API_URL'),
        VITE_SUPABASE_PUBLISHABLE_KEY: need('PUBLISHABLE_KEY'),
      },
    },
    {
      // Le serveur ne s'arrête pas tant qu'un client lui reste attaché : le conteneur s'arrête dès que son entrée
      // se ferme (Playwright arrête `docker run`) ou à SIGTERM. Nommé, pour retirer celui d'un passage interrompu.
      command: [
        `docker rm -f oikos-playwright-${VISUAL_PORT} >/dev/null 2>&1;`,
        `exec docker run --rm -i --init --network host --name oikos-playwright-${VISUAL_PORT}`,
        `-v ${playwrightCore}:/playwright-core:ro`,
        `mcr.microsoft.com/playwright:v${playwrightVersion}-noble sh -c`,
        `'node /playwright-core/cli.js run-server --host 127.0.0.1 --port ${VISUAL_PORT} & cat; kill -9 $!'`,
      ].join(' '),
      port: VISUAL_PORT,
      reuseExistingServer: !process.env['CI'],
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      // Au premier lancement, l'image se télécharge.
      timeout: 600_000,
    },
  ],
});
