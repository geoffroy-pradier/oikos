/** Contraste WCAG 2.x entre deux couleurs `#rrggbb`. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** Seuils AA : 4,5 pour le texte, 3 pour les éléments d'interface (bordures de champ, focus). */
export const AA_TEXT = 4.5;
export const AA_UI = 3;

/** Couples (premier plan, fond) utilisés par les composants ; chacun doit tenir son seuil dans les deux thèmes. */
export const CONTRAST_PAIRS: readonly (readonly [string, string, number])[] = [
  ['foreground', 'background', AA_TEXT],
  ['foreground', 'surface', AA_TEXT],
  ['foreground', 'surface-raised', AA_TEXT],
  ['foreground', 'muted', AA_TEXT],
  ['muted-foreground', 'background', AA_TEXT],
  ['muted-foreground', 'surface', AA_TEXT],
  ['muted-foreground', 'surface-raised', AA_TEXT],
  ['muted-foreground', 'muted', AA_TEXT],
  ['primary-foreground', 'primary', AA_TEXT],
  ['primary-foreground', 'primary-hover', AA_TEXT],
  // Pastilles et indicateurs : texte de la teinte sur son fond atténué.
  ['primary', 'primary-subtle', AA_TEXT],
  ['accent', 'accent-subtle', AA_TEXT],
  ['aegean', 'aegean-subtle', AA_TEXT],
  ['success', 'success-subtle', AA_TEXT],
  ['danger', 'danger-subtle', AA_TEXT],
  ['success', 'surface', AA_TEXT],
  ['primary', 'background', AA_TEXT],
  ['primary', 'surface', AA_TEXT],
  ['accent', 'background', AA_TEXT],
  ['accent', 'surface', AA_TEXT],
  ['aegean', 'background', AA_TEXT],
  ['aegean', 'surface', AA_TEXT],
  ['danger', 'background', AA_TEXT],
  ['danger', 'surface', AA_TEXT],
  ['border', 'background', AA_UI],
  ['border', 'surface', AA_UI],
  ['border', 'surface-raised', AA_UI],
  ['focus', 'background', AA_UI],
  ['focus', 'surface', AA_UI],
];
