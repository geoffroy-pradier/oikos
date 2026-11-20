import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { test as base } from '@playwright/test';

/**
 * Navigateur du contrôle visuel (#700) : le Chromium de l'image Docker officielle de Playwright, à la version du
 * dépôt, joint par `run-server` sur le réseau de l'hôte (Linux). Les images de référence sont ainsi produites et
 * comparées dans le même environnement de rendu (polices du système, réglages de fontconfig), en local comme en
 * `ci` ; le navigateur de l'hôte rend le texte autrement d'une machine à l'autre. Seuls les tests qui importent ce
 * `test` démarrent le conteneur, un par processus de test : les autres tests de bout en bout se passent de Docker.
 */
const resolve = createRequire(import.meta.url).resolve;
const playwrightTest = resolve('@playwright/test/package.json');
const playwrightCore = dirname(
  createRequire(createRequire(playwrightTest).resolve('playwright/package.json')).resolve(
    'playwright-core/package.json',
  ),
);
const version = (JSON.parse(readFileSync(playwrightTest, 'utf8')) as { version: string }).version;
export const VISUAL_IMAGE = `mcr.microsoft.com/playwright:v${version}-noble`;

/** Un port libre de l'hôte, que le serveur du conteneur reprend aussitôt. */
function freePort() {
  return new Promise<number>((done, fail) => {
    const server = createServer().once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? done(address.port) : fail()));
    });
  });
}

export const test = base.extend({
  connectOptions: [
    // eslint-disable-next-line no-empty-pattern -- Playwright exige la déstructuration des dépendances.
    async ({}, use) => {
      const port = await freePort();
      // Le serveur ne s'arrête pas tant qu'un client lui reste attaché : le conteneur s'arrête dès que son entrée
      // se ferme, à la fin du processus de test comme s'il est interrompu.
      const server = spawn(
        'docker',
        [
          ...['run', '--rm', '-i', '--init', '--network', 'host'],
          ...['-v', `${playwrightCore}:/playwright-core:ro`, VISUAL_IMAGE, 'sh', '-c'],
          `node /playwright-core/cli.js run-server --host 127.0.0.1 --port ${port} & cat; kill -9 $!`,
        ],
        { stdio: ['pipe', 'pipe', 'inherit'] },
      );
      await new Promise<void>((ready, fail) => {
        server.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('Listening on')) ready();
        });
        server.once('error', fail);
        server.once('exit', (code) => fail(new Error(`${VISUAL_IMAGE} : arrêt (${code})`)));
      });
      await use({ wsEndpoint: `ws://127.0.0.1:${port}/` });
      if (server.exitCode !== null) return;
      const stopped = new Promise((done) => server.once('exit', done));
      server.stdin.end();
      await stopped;
    },
    // Au premier lancement, l'image se télécharge (la `ci` la télécharge avant les tests).
    { scope: 'worker', timeout: 600_000 },
  ],
});
