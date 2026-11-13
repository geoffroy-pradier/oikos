import { defineConfig } from 'vitest/config';

const integration = process.env['VITEST_INTEGRATION'] === '1';

export default defineConfig({
  test: {
    // Les tests d'intégration exigent Supabase local : ils ont leur propre commande (`pnpm test:integration`).
    include: integration ? ['src/**/*.integration.test.ts'] : ['src/**/*.test.ts'],
    exclude: integration ? [] : ['src/**/*.integration.test.ts'],
    // Certains tests d'intégration posent une contrainte temporaire pour simuler une panne : les fichiers
    // partagent la même base et s'exécutent donc l'un après l'autre.
    fileParallelism: !integration,
  },
});
