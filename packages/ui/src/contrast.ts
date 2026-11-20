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

/** Jetons de couleur de `theme.css`, par rôle, dans l'ordre où le catalogue les montre. */
export const COLOR_TOKENS = {
  surfaces: ['background', 'surface', 'surface-raised', 'muted', 'border', 'border-subtle'],
  text: ['foreground', 'foreground-secondary', 'muted-foreground'],
  accent: [
    'primary',
    'primary-hover',
    'primary-foreground',
    'primary-subtle',
    'accent',
    'accent-subtle',
    'accent-decorative',
    'focus',
  ],
  states: [
    'success',
    'success-subtle',
    'warning',
    'warning-subtle',
    'danger',
    'danger-subtle',
    'info',
    'info-subtle',
    'aegean',
    'aegean-subtle',
  ],
  map: ['sea', 'land', 'coast', 'shoal', 'route'],
  inverse: ['inverse', 'inverse-foreground', 'inverse-muted'],
} as const;

/** Couples (premier plan, fond) utilisés par les composants ; chacun doit tenir son seuil dans les deux thèmes. */
export const CONTRAST_PAIRS: readonly (readonly [string, string, number])[] = [
  ['foreground', 'background', AA_TEXT],
  ['foreground', 'surface', AA_TEXT],
  ['foreground', 'surface-raised', AA_TEXT],
  ['foreground', 'muted', AA_TEXT],
  // Trois niveaux de texte : principal, secondaire, atténué.
  ['foreground-secondary', 'background', AA_TEXT],
  ['foreground-secondary', 'surface', AA_TEXT],
  ['foreground-secondary', 'surface-raised', AA_TEXT],
  ['foreground-secondary', 'muted', AA_TEXT],
  ['muted-foreground', 'background', AA_TEXT],
  ['muted-foreground', 'surface', AA_TEXT],
  ['muted-foreground', 'surface-raised', AA_TEXT],
  ['muted-foreground', 'muted', AA_TEXT],
  ['primary-foreground', 'primary', AA_TEXT],
  ['primary-foreground', 'primary-hover', AA_TEXT],
  // Pastilles et indicateurs : texte de la teinte sur son fond atténué.
  ['primary', 'primary-subtle', AA_TEXT],
  // Carte de choix sélectionnée (cité à la fondation) : texte courant sur `primary-subtle`.
  ['foreground', 'primary-subtle', AA_TEXT],
  ['muted-foreground', 'primary-subtle', AA_TEXT],
  ['foreground-secondary', 'primary-subtle', AA_TEXT],
  ['accent', 'accent-subtle', AA_TEXT],
  // Survol d'un onglet de la barre latérale (`Shell`) : texte accentué sur `muted`.
  ['primary', 'muted', AA_TEXT],
  ['accent', 'muted', AA_TEXT],
  ['aegean', 'aegean-subtle', AA_TEXT],
  ['success', 'success-subtle', AA_TEXT],
  ['danger', 'danger-subtle', AA_TEXT],
  ['warning', 'warning-subtle', AA_TEXT],
  ['info', 'info-subtle', AA_TEXT],
  // Montant calculé d'après une saisie (net attendu d'une vente à l'agora) : texte courant sur `info-subtle`.
  ['foreground', 'info-subtle', AA_TEXT],
  ['success', 'surface', AA_TEXT],
  ['primary', 'background', AA_TEXT],
  ['primary', 'surface', AA_TEXT],
  ['accent', 'background', AA_TEXT],
  ['accent', 'surface', AA_TEXT],
  ['aegean', 'background', AA_TEXT],
  ['aegean', 'surface', AA_TEXT],
  ['danger', 'background', AA_TEXT],
  ['danger', 'surface', AA_TEXT],
  // Teintes en texte sur la fiche surélevée et sur le fond, pour les états.
  ['accent', 'surface-raised', AA_TEXT],
  ['danger', 'surface-raised', AA_TEXT],
  ['success', 'background', AA_TEXT],
  ['success', 'surface-raised', AA_TEXT],
  ['warning', 'background', AA_TEXT],
  ['warning', 'surface', AA_TEXT],
  ['warning', 'surface-raised', AA_TEXT],
  ['info', 'background', AA_TEXT],
  ['info', 'surface', AA_TEXT],
  ['info', 'surface-raised', AA_TEXT],
  // Carte : les noms se lisent sur la mer comme sur les terres.
  ['foreground', 'sea', AA_TEXT],
  ['foreground', 'land', AA_TEXT],
  ['foreground', 'shoal', AA_TEXT],
  // Échelle de la carte, en texte atténué sur la mer.
  ['muted-foreground', 'sea', AA_TEXT],
  // Routes et cités de la carte (#696) : accent pour celles de la maison, `route` pour les autres, sur la mer,
  // les hauts-fonds et la terre qu'elles traversent.
  ['primary', 'sea', AA_UI],
  ['primary', 'shoal', AA_UI],
  ['primary', 'land', AA_UI],
  ['route', 'sea', AA_UI],
  ['route', 'shoal', AA_UI],
  ['route', 'land', AA_UI],
  // Illustrations : le trait porte la forme et se détache des aplats doux et neutre (seuil graphique).
  ['foreground', 'primary-subtle', AA_UI],
  ['foreground', 'muted', AA_UI],
  // Vignettes des cités : le trait de l'île et de son motif sur la mer et sur la terre.
  ['foreground', 'sea', AA_UI],
  ['foreground', 'land', AA_UI],
  ['border', 'background', AA_UI],
  ['border', 'surface', AA_UI],
  ['border', 'surface-raised', AA_UI],
  ['focus', 'background', AA_UI],
  ['focus', 'surface', AA_UI],
  ['focus', 'surface-raised', AA_UI],
  // Pastille active (onglets, choix segmentés) : fond plein du texte, texte couleur du fond.
  ['background', 'foreground', AA_TEXT],
  // Interrupteur allumé sur une fiche relevée (éteint : sa bordure, et sa pastille sur la piste, sont
  // déjà tenues ; bord accent ou danger des champs aussi, au seuil du texte).
  ['primary', 'surface-raised', AA_UI],
  // Plan inversé (trésorerie du tableau de bord sur téléphone) : deux niveaux de texte, la courbe en accent.
  ['inverse-foreground', 'inverse', AA_TEXT],
  ['inverse-muted', 'inverse', AA_TEXT],
  ['accent-decorative', 'inverse', AA_UI],
  // Foyer d'un lien de la carte inversée (« Aller à l'agora »).
  ['focus', 'inverse', AA_UI],
];
