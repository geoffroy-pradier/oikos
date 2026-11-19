import { circle as o, drawing, paths, Svg, type IllustrationProps } from './svg';

/** Emblèmes des dieux, sur une grille de 48, posés sur un disque doux (codes de ton : `svg.tsx`). */
const GODS: Record<string, string> = {
  // Déméter : un épi entre deux feuilles.
  demeter: `
    - M24 41V17
    - M24 31c-3.6 0-6-2.4-6-6 3.6 0 6 2.4 6 6Zm0 0c3.6 0 6-2.4 6-6-3.6 0-6 2.4-6 6Z
    - M24 24c-3.6 0-6-2.4-6-6 3.6 0 6 2.4 6 6Zm0 0c3.6 0 6-2.4 6-6-3.6 0-6 2.4-6 6Z
    a M24 17c-2-1.6-2-5.4 0-7 2 1.6 2 5.4 0 7Z
    a M24 40.5c-1-5.6-4.6-9.4-10.5-10.5.8 5.6 4.6 9.6 10.5 10.5Zm0 0c1-5.6 4.6-9.4 10.5-10.5-.8 5.6-4.6 9.6-10.5 10.5Z`,
  // Athéna : la chouette.
  athena: `
    - M14 11.5l5 4a12 12 0 0 1 10 0l5-4V28c0 6.2-4.5 10.5-10 10.5S14 34.2 14 28Z
    a ${o(19.6, 22, 3.8)}
    a ${o(28.4, 22, 3.8)}
    I ${o(19.6, 22, 1.4)}${o(28.4, 22, 1.4)}
    - M22.6 27h2.8L24 29.4Z
    - M21 38.5v2.5M27 38.5v2.5`,
  // Dionysos : la grappe et sa feuille de vigne.
  dionysos: `
    - M24 17.5V10.5M24 12.5c2.6-2.6 6.8-2 8 1
    a M23.5 13c-3-4-9-4.4-11.5-1.2 3 3.6 8.6 4.2 11.5 1.2Z
    - ${o(17, 21, 3.5)}${o(24, 21, 3.5)}${o(31, 21, 3.5)}
    - ${o(20.5, 27.1, 3.5)}${o(27.5, 27.1, 3.5)}${o(24, 33.2, 3.5)}`,
  // Poséidon : le trident.
  poseidon: `
    - M24 41V9M16 12v4a8 8 0 0 0 16 0v-4
    a M13.8 13 16 7.5l2.2 5.5ZM21.8 10.5 24 5l2.2 5.5ZM29.8 13 32 7.5l2.2 5.5Z
    a M21.5 31h5v4h-5Z`,
  // Apollon : la lyre.
  apollo: `
    - M19 34c-5.5-3-7.5-9.5-5-15 1.2-2.6 2-4.6.6-7.2M29 34c5.5-3 7.5-9.5 5-15-1.2-2.6-2-4.6-.6-7.2
    - M15.2 16h17.6M21 16v17M24 16v17M27 16v17
    a M17 33h14c0 3-3.1 5-7 5s-7-2-7-5Z`,
};

/** Repli neutre d'un dieu inconnu : une étoile au trait. */
const UNKNOWN_GOD = `
  - M24 13c.8 6.4 4.6 10.2 11 11-6.4.8-10.2 4.6-11 11-.8-6.4-4.6-10.2-11-11 6.4-.8 10.2-4.6 11-11Z`;

/** Identifiants des dieux dessinés. */
export const GOD_EMBLEM_IDS = Object.keys(GODS);

export interface GodEmblemProps extends IllustrationProps {
  godId: string;
  /** Côté en pixels, 48 par défaut. */
  size?: number;
}

/** Emblème d'un dieu sur son disque ; un dieu inconnu reçoit une étoile neutre. */
export function GodEmblem({ godId, size = 48, ...props }: GodEmblemProps) {
  return (
    <Svg viewBox="0 0 48 48" width={size} height={size} {...props}>
      {paths(`S ${o(24, 24, 23)}`)}
      {drawing(GODS, godId, UNKNOWN_GOD)}
    </Svg>
  );
}
