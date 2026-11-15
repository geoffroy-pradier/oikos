import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/.turbo/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Le client n'embarque que les schémas de la configuration, jamais son chargeur (accès base).
    files: ['apps/web/src/**'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: '@oikos/config', message: "Importer '@oikos/config/schema'." }] },
      ],
    },
  },
  {
    // Le back-office ne contrôle pas la configuration, l'API fait foi : seuls ses tests lisent le schéma.
    files: ['apps/admin/src/**'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['@oikos/config*'] }] },
  },
  {
    // Forcer les contrôles différés contourne ceux de la validation, dont celui des activations de
    // configuration : limite assumée tant qu'aucun code du jeu ne le fait (ticket 208, spécification 13).
    files: ['apps/*/src/**', 'packages/*/src/**'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'Literal[value=/set\\s+constraints/i]',
          'TemplateElement[value.raw=/set\\s+constraints/i]',
        ].map((selector) => ({
          selector,
          message: 'Le code du jeu ne force jamais les contrôles différés (spécification 13).',
        })),
      ],
    },
  },
  {
    // Scripts Node hors TypeScript (outillage).
    files: ['**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
);
