import { circle as o, drawing, ellipse, paths, Svg, type IllustrationProps } from './svg';

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
  // Zeus : la foudre.
  zeus: `
    a M26 7 16 26h8l-4 15 14-21h-8l6-13Z
    - M12 17l3.5 1.5M11.5 23H15M36.5 31 33 29.5M36.5 25H33`,
  // Héra : la plume de paon et son œil.
  hera: `
    - M14 42 21.1 30.7M15.6 39.5l4.1-.5M15.6 39.5l-1.3-3.9M17.5 36.5l4-.5M17.5 36.5l-1.4-3.9
    - ${ellipse(27.5, 20.5, 12, 7, -57.9)}
    a ${ellipse(29.2, 17.8, 5.4, 4, -57.9)}
    I ${o(29.5, 17.4, 1.8)}`,
  // Artémis : l'arc tendu, sa flèche, et le croissant de lune.
  artemis: `
    - M16 9c10 3.5 14 9.5 14 15s-4 11.5-14 15M16 9v30M9 24h26
    - M9 24l-2.5-2.5M9 24l-2.5 2.5M12.5 24 10 21.5M12.5 24 10 26.5
    a M38 24l-5-3.5v7Z
    A ${o(35, 13, 4.6)}
    S ${o(37.2, 11.4, 3.9)}`,
  // Arès : le casque à cimier.
  ares: `
    a M21 16.5c-6-2-8-6.5-7-11 3.5 1.5 6.5 1.5 10 1.5s6.5 0 10-1.5c1 4.5-1 9-7 11Z
    - M19 9l2.5 6.5M24 9v7M29 9l-2.5 6.5
    s M14 26a10 10 0 0 1 20 0v8l-5 7h-3v-9h-4v9h-3l-5-7Z
    I M16.5 26h6v2.5h-6ZM25.5 26h6v2.5h-6Z`,
  // Aphrodite : la coquille Saint-Jacques.
  aphrodite: `
    a M24 36 10.5 22c1.5-7 7-12 13.5-12s12 5 13.5 12Z
    - M24 36 14 16.5M24 36l-5-24M24 36V10M24 36l5-24M24 36l10-19.5
    - M19 36h10l-1.5 4h-7Z`,
  // Héphaïstos : le marteau sur l'enclume.
  hephaistos: `
    - M9 26h28v2.5c0 1.5-1 2.5-2.5 2.5H30l-1.5 4H32v4H16v-4h3.5L18 31h-3c-3 0-5-2-6-5Z
    - M12 22.5 26.5 11
    a M21 9l4-4 9 9-4 4Z
    - M37 19.5l3-2M38.5 23.5h3.5`,
  // Hermès : le caducée ailé.
  hermes: `
    - M24 12v30
    - M20.5 17.5c-3 1.5-1 5 3.5 6.5s6.5 5 3.5 6.5-6.5 4-3.5 6.5
    - M27.5 17.5c3 1.5 1 5-3.5 6.5s-6.5 5-3.5 6.5 6.5 4 3.5 6.5
    a M22 14c-3-3.5-7.5-4.5-12-3.5 2 3.5 6.5 5.5 12 5.5ZM26 14c3-3.5 7.5-4.5 12-3.5-2 3.5-6.5 5.5-12 5.5Z
    a ${o(24, 10, 2.2)}`,
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
