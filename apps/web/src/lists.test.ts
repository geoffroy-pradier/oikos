// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatList } from './lists';

describe('énumérations', () => {
  it('suivent la langue de l’écran, sans séparateur en dur', () => {
    expect(formatList('fr', ['80 × Blé', '16 × Farine', '2 × Sel'])).toBe(
      '80 × Blé, 16 × Farine et 2 × Sel',
    );
    expect(formatList('en', ['wheat', 'flour', 'salt'])).toBe('wheat, flour, and salt');
  });

  it('un seul élément reste tel quel, aucun donne une chaîne vide', () => {
    expect(formatList('fr', ['80 × Blé'])).toBe('80 × Blé');
    expect(formatList('fr', [])).toBe('');
  });
});
