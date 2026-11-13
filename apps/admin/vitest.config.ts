import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Les tests de bout en bout (e2e/) sont lancés par Playwright, pas par Vitest.
  test: { include: ['src/**/*.test.{ts,tsx}'] },
});
