import { defineConfig } from 'vitest/config';

const integration = process.env['VITEST_INTEGRATION'] === '1';

export default defineConfig({
  test: {
    // Les tests d'intégration exigent Supabase local : ils ont leur propre commande (`pnpm test:integration`).
    include: integration ? ['src/**/*.integration.test.ts'] : ['src/**/*.test.ts'],
    exclude: integration ? [] : ['src/**/*.integration.test.ts'],
  },
});
