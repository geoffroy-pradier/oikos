// Empaquette une application Node du monorepo (API, moteur) en un seul fichier ESM, dépendances comprises.
// Usage : node infra/docker/bundle.mjs <api|engine> <fichier de sortie>
import { build } from 'esbuild';

const [app, outfile] = process.argv.slice(2);
if (!['api', 'engine'].includes(app ?? '') || !outfile) {
  console.error('usage: node infra/docker/bundle.mjs <api|engine> <outfile>');
  process.exit(2);
}

await build({
  entryPoints: [`apps/${app}/src/main.ts`],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  // Liaison native facultative de `pg`, jamais installée.
  external: ['pg-native'],
  // Les dépendances CommonJS empaquetées appellent `require` : on le fournit au module ESM.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
