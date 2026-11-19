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
};

/** Repli neutre d'un bien inconnu : une caisse. */
const UNKNOWN_GOOD = `
  m M4 7.5 12 3.5l8 4v9l-8 4-8-4Z
  - M4 7.5l8 4 8-4M12 11.5v9`;

/** Identifiants des biens dessinés. */
export const GOOD_ICON_IDS = Object.keys(GOODS);

export interface GoodIconProps extends IllustrationProps {
  goodId: string;
  /** 24 px dans une ligne de texte ou un tableau, 48 px dans une fiche (trait un peu plus fin). */
  size?: 24 | 48;
}

/** Pictogramme d'un bien ; un bien inconnu reçoit une caisse neutre. */
export function GoodIcon({ goodId, size = 24, ...props }: GoodIconProps) {
  const strokeWidth = size > 24 ? 1.5 : 2;
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} strokeWidth={strokeWidth} {...props}>
      {drawing(GOODS, goodId, UNKNOWN_GOOD)}
    </Svg>
  );
}
