import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      // Les textes français portent une espace insécable avant « : ; ! ? » (vérifiée sur le fichier même, par
      // `locales.test.ts`). Testing Library ramène le texte du DOM aux espaces ordinaires, mais pas le texte
      // cherché : en test seulement, la traduction les garde ordinaires, des deux côtés de la comparaison.
      name: 'oikos-espaces-ordinaires',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/locales/fr.json')) return code.replaceAll('\u00a0', ' ');
        return undefined;
      },
    },
  ],
  // Les tests de bout en bout (e2e/) sont lancés par Playwright, pas par Vitest.
  test: { include: ['src/**/*.test.{ts,tsx}'] },
});
