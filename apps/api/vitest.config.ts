import { defineConfig } from 'vitest/config';

const integration = process.env['VITEST_INTEGRATION'] === '1';
// Banc d'équilibrage des quatre cités (#281) : ses fichiers `.bench.ts` ne sont des tests ni des tests d'intégration.
const balance = process.env['VITEST_BALANCE'] === '1';

export default defineConfig({
  test: {
    // Les tests d'intégration exigent Supabase local : ils ont leur propre commande (`pnpm test:integration`).
    include: balance
      ? ['src/**/*.bench.ts']
      : integration
        ? ['src/**/*.integration.test.ts']
        : ['src/**/*.test.ts'],
    exclude: integration || balance ? [] : ['src/**/*.integration.test.ts'],
    // Un conflit entre transactions, rejoué par le registre, fait échouer un test qui ne l'accepte pas (#333).
    setupFiles: integration || balance ? ['src/conflicts.integration-fixtures.ts'] : [],
    // Certains tests d'intégration posent une contrainte temporaire pour simuler une panne : les fichiers
    // partagent la même base et s'exécutent donc l'un après l'autre.
    fileParallelism: !(integration || balance),
  },
});
