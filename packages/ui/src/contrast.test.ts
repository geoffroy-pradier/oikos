import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRS, contrastRatio } from './contrast';

/** Lit les variables de couleur d'un bloc de `theme.css`. */
function tokens(selector: string): Record<string, string> {
  const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Bloc ${selector} introuvable`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1] ?? '', m[2] ?? '']),
  );
}

describe('contrastRatio', () => {
  it('donne les valeurs de référence du WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#ffffff', '#777777')).toBe(contrastRatio('#777777', '#ffffff'));
  });
});

describe.each([
  ['clair', ':root'],
  ['sombre', "[data-theme='dark']"],
])('thème %s : contrastes AA', (_name, selector) => {
  const theme = tokens(selector);

  it('définit les mêmes jetons que l’autre thème', () => {
    expect(Object.keys(theme).sort()).toEqual(Object.keys(tokens(':root')).sort());
  });

  it.each(CONTRAST_PAIRS)('%s sur %s ≥ %s', (foreground, background, threshold) => {
    const [fg, bg] = [theme[foreground], theme[background]];
    if (!fg || !bg) throw new Error(`Jeton manquant : ${foreground} ou ${background}`);
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(threshold);
  });
});
