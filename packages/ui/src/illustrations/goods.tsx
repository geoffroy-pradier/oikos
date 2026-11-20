import { circle as o, drawing, ellipse, Svg, type IllustrationProps } from './svg';

/** Une bûche de (x1, y1) à (x2, y2), de rayon r : écorce, fil du bois, coupe et cerne au bout (x2, y2). */
function log(x1: number, y1: number, x2: number, y2: number, r: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const [nx, ny] = [-Math.sin(angle) * r, Math.cos(angle) * r];
  /** Point à la fraction `t` de l'axe, décalé de `k` rayons sur sa normale. */
  const at = (t: number, k: number) =>
    `${+(x1 + t * (x2 - x1) + k * nx).toFixed(2)} ${+(y1 + t * (y2 - y1) + k * ny).toFixed(2)}`;
  const deg = +((angle * 180) / Math.PI).toFixed(1);
  return `
    s M${at(0, 1)}L${at(1, 1)}L${at(1, -1)}L${at(0, -1)}A${r} ${r} 0 0 0 ${at(0, 1)}Z
    - M${at(0.15, 0.3)}L${at(0.5, 0.3)}
    a ${ellipse(x2, y2, r * 0.55, r, deg)}
    I ${ellipse(x2, y2, r * 0.18, r * 0.34, deg)}`;
}

/** Alvéole hexagonale de centre (cx, cy) et de rayon r, pointe en haut. */
const cell = (cx: number, cy: number, r: number) =>
  `M${[-90, -30, 30, 90, 150, 210]
    .map((deg) => (deg * Math.PI) / 180)
    .map((rad) => `${+(cx + r * Math.cos(rad)).toFixed(2)} ${+(cy + r * Math.sin(rad)).toFixed(2)}`)
    .join('L')}Z`;

/** Pictogrammes des biens, sur une grille de 24 (codes de ton : voir `svg.tsx`). */
const GOODS: Record<string, string> = {
  wheat: `
    - M12 21.5V9
    s M12 18c-3 0-5-2-5-5 3 0 5 2 5 5Zm0 0c3 0 5-2 5-5-3 0-5 2-5 5Z
    s M12 13c-3 0-5-2-5-5 3 0 5 2 5 5Zm0 0c3 0 5-2 5-5-3 0-5 2-5 5Z
    a M12 8.5c-1.6-1.3-1.6-4.2 0-5.5 1.6 1.3 1.6 4.2 0 5.5Z`,
  olives: `
    - M4 21C8 16 12 10 19.5 3.5
    s M10.5 13C7.5 12.5 5.6 10 6 6.5c3 .5 5 3 4.5 6.5Z
    s M15 7.6c.6-2.6 3.1-4.3 5.6-4-.6 2.6-3 4.3-5.6 4Z
    a ${ellipse(14.5, 16, 2.6, 3.3, -35)}
    a ${ellipse(18.6, 10.8, 2, 2.6, -35)}`,
  grapes: `
    - M12 7.5V3.5
    a M12.2 4.6c1.2-2 3.8-2.8 6.3-2-1.2 2-3.8 2.8-6.3 2Z
    s ${o(7, 10, 2.5)}
    s ${o(12, 10, 2.5)}
    s ${o(17, 10, 2.5)}
    s ${o(9.5, 14.4, 2.5)}
    s ${o(14.5, 14.4, 2.5)}
    s ${o(12, 18.8, 2.5)}`,
  wood: `${log(19.5, 19, 5.5, 8.5, 3.2)}${log(4.5, 19, 18.5, 8.5, 3.2)}`,
  clay: `
    s M3 20c.7-4.6 4-7.5 8.5-7.5S19.3 15.4 20 20Z
    - M2 20h20M18.4 2.6 16 10M16.8 2.1l3.2 1
    a M13.8 9.4 18 10.7l-.9 2.9-3.1 2.6-1-3.9Z`,
  wool: `
    s ${o(11, 12.5, 8)}
    - M5 7.4c4.5.4 9 4.4 10 11.6M8.7 4.8c4 1.8 7 6.4 7.2 12.4M3.4 13.6c3.6-.4 6.8 1.8 8 6.7
    l M17 18.6c1.6 1.8 3.5 2 5 .9`,
  fish: `
    a M16.5 12 21.5 8v8Z
    s M2.5 12c3.5-5 10-5.6 14 0-4 5.6-10.5 5-14 0Z
    - M10.5 8.9c.9 2 .9 4.2 0 6.2
    I ${o(6.6, 11, 1.1)}`,
  salt: `
    - M5.8 14c1-3.4 3.3-5.5 6.2-5.5s5.2 2.1 6.2 5.5
    s M3 14h18c-.5 4-4.2 7-9 7s-8.5-3-9-7Z
    A M17.5 1c.4 2.4 1.3 3.3 3.7 3.7-2.4.4-3.3 1.3-3.7 3.7-.4-2.4-1.3-3.3-3.7-3.7 2.4-.4 3.3-1.3 3.7-3.7Z
    A M7 2.8c.3 1.6.8 2.1 2.4 2.4-1.6.3-2.1.8-2.4 2.4-.3-1.6-.8-2.1-2.4-2.4 1.6-.3 2.1-.8 2.4-2.4Z`,
  flour: `
    s M9 8c-2.6 2.4-5 5.7-5 9 0 2.6 1.9 4 4.6 4h6.8c2.7 0 4.6-1.4 4.6-4 0-3.3-2.4-6.6-5-9Z
    - M9 8h6M9.6 8 8 3.5h8L14.4 8
    a M12 19c-1.6-1.3-1.6-4.2 0-5.5 1.6 1.3 1.6 4.2 0 5.5Z`,
  olive_oil: `
    a M12 2.5c3.6 4.6 7 8.4 7 12a7 7 0 0 1-14 0c0-3.6 3.4-7.4 7-12Z
    - M8.6 14.6a3.5 3.5 0 0 0 3.2 3.4`,
  charcoal: `
    m M2.5 20.5 4 15.2l5-2.2 3.6 3.4-1 3.9Z
    m M12 20.5l1-4.4 4.2-2.6 4.1 3 .2 4Z
    a M12 2.5c2.4 2.4 3.5 4.4 3.5 6.3a3.5 3.5 0 0 1-7 0c0-1.2.6-2.3 1.4-3 .2 1.1.8 1.8 1.6 2 0-2-.2-3.6.5-5.3Z`,
  cloth: `
    s M6.5 13.5H19a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6.5a3.5 3.5 0 0 1 0-7Z
    A M14.8 14.5h2.4v5h-2.4Z
    - M6.5 13.5a2 2 0 0 0 0 4H21
    s M8.5 5H17a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2H8.5a3.25 3.25 0 0 1 0-6.5Z
    A M12.8 6h2.4v4.5h-2.4Z
    - M8.5 5a1.85 1.85 0 0 0 0 3.7H19`,
  bread: `
    s M3 17c0-5.6 4-9.5 9-9.5s9 3.9 9 9.5v.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z
    l M7.5 12l1.6 2.6M11.5 11l1.6 2.6M15.5 12l1.6 2.6`,
  wine: `
    s M3 9.5c0 3.6 4 6 9 6s9-2.4 9-6
    a ${ellipse(12, 9.5, 9, 2.2)}
    - M3.4 11c-2.4-.3-2.4-3.3-.4-3.4M20.6 11c2.4-.3 2.4-3.3.4-3.4
    - M12 15.5v3M8.5 20.5c.8-1.3 2-2 3.5-2s2.7.7 3.5 2Z`,
  amphorae: `
    s M10 7c-3 1-5.5 3.6-5.5 7 0 3 2.7 5.6 7.5 8 4.8-2.4 7.5-5 7.5-8 0-3.4-2.5-6-5.5-7Z
    A M5.2 11.3h13.6v2.4H5.2Z
    - M10 7c-3 1-5.5 3.6-5.5 7 0 3 2.7 5.6 7.5 8 4.8-2.4 7.5-5 7.5-8 0-3.4-2.5-6-5.5-7Z
    - M10 7V3.5h4V7M9 3.5h6
    - M10 5H8.6A1.8 1.8 0 0 0 6.8 7v1.6M14 5h1.4a1.8 1.8 0 0 1 1.8 2v1.6`,
  barley: `
    - M12 21.5V14
    l M8.4 9.6 5 4.2M15.6 9.6 19 4.2M8.4 5.6 6.6 1.5M15.6 5.6l1.8-4.1
    s ${ellipse(9.8, 12, 1.7, 2.7, -28)}
    s ${ellipse(14.2, 12, 1.7, 2.7, 28)}
    s ${ellipse(9.8, 8, 1.7, 2.7, -28)}
    s ${ellipse(14.2, 8, 1.7, 2.7, 28)}
    s ${ellipse(12, 4.4, 1.5, 2.4)}`,
  flax: `
    - M10 21.5 12 15 7.8 8.4M12 21.5V7M14 21.5 12 15l4.2-6.6
    s M10.2 13.6h3.6v2.8h-3.6Z
    a ${o(7.4, 6.2, 2.3)}
    a ${o(12, 4.6, 2.3)}
    a ${o(16.6, 6.2, 2.3)}`,
  figs: `
    - M15.5 4.6V2.5
    s M15.5 4.6c-.8 2.2-5 4-5 8a5 5 0 0 0 10 0c0-4-4.2-5.8-5-8Z
    a M8.5 9.4c-.8 2.2-5 3.8-5 7.3a5 5 0 0 0 10 0c0-3.5-4.2-5.1-5-7.3Z
    s M8.5 13c-.5 1.4-2.6 2.4-2.6 4.2a2.6 2.6 0 0 0 5.2 0c0-1.8-2.1-2.8-2.6-4.2Z`,
  hides: `
    s M12 4.2 14.5 5l3-2 2.3 2.2-2.8 3c1.2 2.6 1.2 5.2 0 7.8l2.8 3-2.3 2-3-2-2.5 1.5-2.5-1.5-3 2-2.3-2 2.8-3c-1.2-2.6-1.2-5.2 0-7.8l-2.8-3L6.5 3l3 2Z
    l M12 8.5v7`,
  honey: `
    s ${cell(8.54, 8, 4)}
    s ${cell(15.46, 8, 4)}
    a ${cell(12, 14, 4)}
    a M12 18c1 1.4 1.8 2.3 1.8 3.1a1.8 1.8 0 0 1-3.6 0c0-.8.8-1.7 1.8-3.1Z`,
  marble: `
    s M3 20.5 4.5 11l5-5.5 6.5 1 4.5 5 .5 9Z
    - M4.5 11 11 13l5-6M11 13l-1 7.5
    l M6 15.5c1.5-.5 2 .8 3.4.3M13.5 12.5c1.6.6 2.4 2.4 4.8 2.2M12.6 17.2c1.6-.2 2.6.7 4.4.4`,
  copper: `
    a M3 6c3 1.2 6 1.8 9 1.8S18 7.2 21 6c-1.4 4-1.4 8 0 12-3-1.2-6-1.8-9-1.8S6 16.8 3 18c1.4-4 1.4-8 0-12Z
    - M9 12h6`,
  tin: `
    m M3 20.5 4.2 16.5h6.6l1.2 4Z
    m M12 20.5l1.2-4h6.6l1.2 4Z
    m M7.5 16.5l1.2-4h6.6l1.2 4Z`,
  iron: `
    - M17.5 14 7.3 5.9M4.5 10.7Q6.1 4.9 11.5 2.3
    m M3 20.5 4.6 15l4.2-3 4.4 1.4 3.6-1.2 3.8 3.6.4 4.7Z`,
  silver: `
    s M7 10h10l1.5 3.5h-13Z
    s M5.5 13.5h13l2 6h-17Z
    A M19.5 1c.4 2.4 1.3 3.3 3.7 3.7-2.4.4-3.3 1.3-3.7 3.7-.4-2.4-1.3-3.3-3.7-3.7 2.4-.4 3.3-1.3 3.7-3.7Z
    A M4.5 3.6c.3 1.6.8 2.1 2.4 2.4-1.6.3-2.1.8-2.4 2.4-.3-1.6-.8-2.1-2.4-2.4 1.6-.3 2.1-.8 2.4-2.4Z`,
  barley_flour: `
    s M8 7.5c-3 2-5 5-5 8.5 0 2.7 2 4.5 5 4.5h8c3 0 5-1.8 5-4.5 0-3.5-2-6.5-5-8.5Z
    - M8 7.5c1.2.8 2.6 1 4 1s2.8-.2 4-1M8.4 7.5 7.6 4h8.8l-.8 3.5
    l M12 14.2V19
    a ${ellipse(10.4, 16, 1, 1.8, -25)}
    a ${ellipse(13.6, 16, 1, 1.8, 25)}
    a ${ellipse(12, 12.4, 1, 1.7)}`,
  must: `
    s M4 11h16l-1.6 9a1.5 1.5 0 0 1-1.5 1.2H7.1A1.5 1.5 0 0 1 5.6 20Z
    - M3 11h18M4.7 15.5h14.6
    a M12 2.5c2 2.6 3.6 4.4 3.6 6.2a3.6 3.6 0 0 1-7.2 0c0-1.8 1.6-3.6 3.6-6.2Z`,
  planks: `
    s M2.5 17h19v3.5h-19Z
    s M4.5 12.5h17V16h-17Z
    s M2.5 8h19v3.5h-19Z
    l M5.5 18.8h5M13 14.3h6M6.5 9.8h6M15 9.8h3
    - M7.5 17v3.5M10 12.5V16M17 8v3.5`,
  bronze: `
    a M4 9h16c0 5-3.4 8.5-8 8.5S4 14 4 9Z
    - M3 9h18M8 16.4 6.5 21M16 16.4l1.5 4.6M3 9V6.5M21 9V6.5
    l M7.5 12.2c1 1.6 2.6 2.4 4.5 2.4`,
  wrought_iron: `
    m M2.5 10h13.5l4.5 2.5c-1.2 1.2-2.8 1.6-5 1.6H14V15l1.8 2.5V20H5.8v-2.5L9.5 15v-.9c-3.5 0-6.2-1-7-4.1Z
    a M5 6.5h9V10H5Z
    - M8.5 6.5V10M11.5 6.5V10`,
  thread: `
    s M6 3.5h12v3H6Z
    s M6 17.5h12v3H6Z
    a M8 6.5h8v11H8Z
    l M8 9h8M8 11.5h8M8 14h8
    - M16 14.2c2.2.4 3.6 1.8 4.2 4.3`,
  leather: `
    s M2 9h14l3 3-3 3H2Z
    - M17.5 5.5H22v13h-4.5ZM17.5 12H22
    l M3.6 10.6h11M3.6 13.4h11
    I ${o(6, 12, 0.8)}
    I ${o(9.3, 12, 0.8)}
    I ${o(12.6, 12, 0.8)}`,
  linen_cloth: `
    s M4 3.5h16v13H4Z
    l M4 7.8h16M4 12.2h16M8 3.5v13M12 3.5v13M16 3.5v13
    - M4 3.5h16v13H4Z
    - M6 16.5v4M9 16.5v4M12 16.5v4M15 16.5v4M18 16.5v4`,
  pigments: `
    s M12 3.5c-5.5 0-9 3.4-9 8 0 4.8 3.6 8.5 8.5 8.5 1.8 0 2.2-1.4 1.5-2.6-.7-1.2.2-2.4 1.6-2.4H18c2.2 0 3.5-1.5 3.5-3.5C21.5 6.5 17.5 3.5 12 3.5Z
    a ${o(8, 8.6, 1.7)}
    a ${o(13, 7, 1.7)}
    a ${o(17.2, 10.2, 1.7)}
    - ${o(8.5, 14.6, 1.4)}`,
  wax: `
    s M8.5 10h7v11h-7Z
    - M12 10V8M9.5 10v3.2a1 1 0 0 0 2 0V10M7 21.5h10
    a M12 2.5c1.7 1.6 2.5 2.9 2.5 4.1a2.5 2.5 0 0 1-5 0c0-1.2.8-2.5 2.5-4.1Z`,
  silver_ingots: `
    s M7 6.5h10l3.5 4.5H3.5Z
    m M3.5 11h17v7H3.5Z
    - M9.5 14.5h5M11 13v3M13 13v3`,
  marble_blocks: `
    s M2.5 14h9v6.5h-9Z
    s M12.5 14h9v6.5h-9Z
    s M7.5 7.5h9V14h-9Z
    l M4.5 17.3c1.5-.8 3 .8 4.5 0M14.5 17.6c1.5-1 3.2.5 4.8-.2M9.5 10.8c1.3-.7 2.6.6 4 0`,
};

/** Repli neutre d'un bien inconnu : une caisse. */
const UNKNOWN_GOOD = `
  m M4 7.5 12 3.5l8 4v9l-8 4-8-4Z
  - M4 7.5l8 4 8-4M12 11.5v9`;

/** Identifiants des biens dessinés. */
export const GOOD_ICON_IDS = Object.keys(GOODS);

/** Repli d'un bien sans dessin propre, selon son niveau (5.1) : corbeille, ballot ficelé, coffre. */
const TIERS: Record<string, string> = {
  raw: `
    a ${o(9, 8, 3)}
    a ${o(15, 8, 3)}
    s M4 11h16l-1.8 9.2a1.5 1.5 0 0 1-1.5 1.3H7.3a1.5 1.5 0 0 1-1.5-1.3Z
    - M4.9 15.5h14.2M9.5 11l.5 10.5M14.5 11l-.5 10.5`,
  intermediate: `
    s M4 7.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z
    l M12 5.5v15M4 13h16
    a ${o(12, 13, 1.8)}`,
  finished: `
    s M4 12c0-3.3 2-5.5 4-5.5h8c2 0 4 2.2 4 5.5Z
    s M4 12h16v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5Z
    a M10.5 10.5h3v4h-3Z`,
};

/** Niveaux de bien qui ont un dessin de repli. */
export const GOOD_TIER_IDS = Object.keys(TIERS);

export interface GoodIconProps extends IllustrationProps {
  goodId: string;
  /** Niveau du bien (`raw`, `intermediate`, `finished`) : un bien sans dessin propre prend celui de son niveau. */
  tier?: string;
  /** 24 px dans une ligne de texte ou un tableau, 48 px dans une fiche (trait un peu plus fin). */
  size?: 24 | 48;
}

/** Pictogramme d'un bien ; sans dessin propre, celui de son niveau, ou à défaut une caisse neutre. */
export function GoodIcon({ goodId, tier = '', size = 24, ...props }: GoodIconProps) {
  const strokeWidth = size > 24 ? 1.5 : 2;
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={strokeWidth} {...props}>
      {drawing(GOODS, goodId, Object.hasOwn(TIERS, tier) ? (TIERS[tier] ?? '') : UNKNOWN_GOOD)}
    </Svg>
  );
}
