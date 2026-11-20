import { circle as o, drawing, paths, Svg, type IllustrationProps } from './svg';

/** Une barque, sa quille en (x, y), longue de 28. */
const hull = (x: number, y: number) => `M${x} ${y}h28l-5 7h-18Z`;
/** Une voile triangulaire sur le mât de la barque posée en (x, y). */
const sail = (x: number, y: number) => `M${x + 14} ${y - 2}v-26l13 22h-13`;
/** Une maison à toit en bâtière, posée en (x, y), large de `w`. */
const house = (x: number, y: number, w = 18) =>
  `M${x} ${y}v-${w * 0.7}l${w / 2}-${w * 0.45} ${w / 2} ${w * 0.45}v${w * 0.7}Z`;
/** Une vague courte. */
const wave = (x: number, y: number) => `M${x} ${y}c3-2.6 7-2.6 10 0s7 2.6 10 0`;
/** Un trait pointillé de (x1, y1) à (x2, y2), en `n` tirets. */
function dashes(x1: number, y1: number, x2: number, y2: number, n: number) {
  const step = (t: number) => `${x1 + (x2 - x1) * t} ${y1 + (y2 - y1) * t}`;
  return Array.from({ length: n }, (_, i) => `M${step(i / n)}L${step((i + 0.55) / n)}`).join('');
}

/**
 * Scène d'accueil (connexion, création de maison), 360 × 200 : un port et une île au lever du jour.
 * En aplats : la mer, la terre et le soleil ; le trait porte chaque forme (contrastes : `contrast.ts`).
 */
const WELCOME = `
  a ${o(252, 112, 30)}
  - M252 70V60M222 82l-7-7M282 82l7-7M210 112h-10M294 112h10
  E M0 112h360v88H0Z
  - M0 112h360
  t M92 112c12-14 28-22 46-22s32 8 42 22Z
  t M318 112c8-7 17-10 27-10 8 0 13 2 17 5v5Z
  - M228 124h48M238 134h28M246 144h12
  t M-2 200v-56c20-8 44-12 70-12 26 0 46 6 62 16 14 9 24 24 30 52Z
  - ${house(20, 174, 16)}${house(42, 172, 20)}${house(68, 176, 16)}
  - M126 162h52M134 162v9M150 162v9M166 162v9
  - ${hull(176, 180)}
  a ${sail(176, 180)}
  - M296 148h14l-2.5 3.5h-9ZM303 148v-12l6.5 10h-6.5
  c ${wave(212, 192)}${wave(300, 176)}${wave(196, 134)}${wave(316, 128)}
  - M92 52l6 5 6-5M114 40l5 4 5-4`;

/** Illustrations d'états vides, 160 × 120, sur un disque doux : une par famille de listes. */
const EMPTY = {
  // Pas de site : une parcelle piquetée, vide, et son jalon.
  noSite: `
    - ${dashes(40, 72, 80, 54, 5)}${dashes(80, 54, 120, 72, 5)}
    - ${dashes(120, 72, 80, 90, 5)}${dashes(80, 90, 40, 72, 5)}
    - M80 74V34
    a M80 34l20 7-20 7Z`,
  // Pas de navire : un quai vide, sa bitte d'amarrage, l'amarre lâche dans l'eau calme, une mouette.
  noShip: `
    - M29 70h55v20H36.2M31.2 80H84M50 70v10M68 80v10
    - M56 70v-3h14v3M59 67V55M67 67V55
    a M55.5 55c0-3.5 3.4-5 7.5-5s7.5 1.5 7.5 5Z
    - M58 60.5h10M68 61c7 0 10 5 12 12 2 8 5 14 12 15.5
    - M84 90h38M90 97h22M98 104h12
    - M98 32c3-3.5 6-3.5 8 0 2-3.5 5-3.5 8 0`,
  // Pas de message : une bulle sans paroles.
  noMessage: `
    - M50 34h60a10 10 0 0 1 10 10v28a10 10 0 0 1-10 10H76l-14 12V82H50a10 10 0 0 1-10-10V44a10 10 0 0 1 10-10Z
    a ${o(66, 58, 4)}${o(80, 58, 4)}${o(94, 58, 4)}`,
  // Pas d'ordre : la balance de l'agora, plateaux vides.
  noOrder: `
    - M80 36v52M64 92h32M48 42h64
    - M48 42l-12 26M48 42l12 26M112 42l-12 26M112 42l12 26
    - M34 68h28c0 6-6 10-14 10s-14-4-14-10ZM98 68h28c0 6-6 10-14 10s-14-4-14-10Z
    a ${o(80, 36, 5)}`,
  // Entrepôt vide : une étagère, la place d'une caisse en pointillé, une amphore seule.
  noStock: `
    - M46 96V26M114 96V26
    m M40 48h80v6H40ZM40 90h80v6H40Z
    - ${dashes(54, 48, 54, 30, 3)}${dashes(54, 30, 80, 30, 4)}${dashes(80, 30, 80, 48, 3)}
    a M98 66h6v3c5 2 8 6 8 10 0 6-4 11-11 11s-11-5-11-11c0-4 3-8 8-10Z
    - M96 66h10`,
  // Aucun bien immobilier : une maison, et l'écriteau encore vierge d'une vente.
  noProperty: `
    - M32 92h96
    m M40 92V64l26-22 26 22v28Z
    - M60 92V78h12v14M48 66h8v8h-8ZM76 66h8v8h-8Z
    - M116 92V66
    a M104 52h24v14h-24Z`,
  // Rien dans la cité : la façade du temple, au calme, le soleil levé derrière elle.
  noEvent: `
    a ${o(98, 36, 10)}
    m M40 52l40-18 40 18Z
    m M40 52h80v6H40Z
    - M48 58v26M64 58v26M80 58v26M96 58v26M112 58v26
    m M34 84h92v6H34Z`,
  // Rien à modérer : la corbeille de courrier vide, et sa coche.
  noReport: `
    - M48 50h64l8 16M48 50l-8 16
    m M40 66h22l5 9h26l5-9h22v22H40Z
    a ${o(116, 34, 10)}
    - M111 34l3.5 3.5 6.5-7`,
  // Aucune écriture : le registre ouvert, ses lignes vides, une obole.
  noEntry: `
    m M80 46c-10-6-26-7-40-3v44c14-4 30-3 40 3ZM80 46c10-6 26-7 40-3v44c-14-4-30-3-40 3Z
    - M80 46v44
    - ${dashes(48, 58, 72, 58, 3)}${dashes(48, 68, 72, 68, 3)}${dashes(88, 58, 112, 58, 3)}
    a ${o(104, 76, 6)}
    - ${o(104, 76, 2.5)}`,
} satisfies Record<string, string>;

/** Famille d'un état vide dessiné : chaque liste vide du jeu et d'Olympe prend celle de sa famille. */
export type EmptyKind = keyof typeof EMPTY;

/** Identifiants des états vides dessinés. */
export const EMPTY_ILLUSTRATION_IDS = Object.keys(EMPTY) as EmptyKind[];

/** Scène d'accueil, 360 × 200 par défaut ; `className="h-auto w-full"` pour qu'elle suive sa colonne. */
export function WelcomeScene(props: IllustrationProps) {
  return (
    <Svg viewBox="0 0 360 200" width={360} height={200} {...props}>
      {paths(WELCOME)}
    </Svg>
  );
}

/** Illustration d'un état vide (160 × 120) ; un état inconnu ne montre que le disque. */
export function EmptyIllustration({ kind, ...props }: IllustrationProps & { kind: string }) {
  return (
    <Svg viewBox="0 0 160 120" width={160} height={120} {...props}>
      {paths(`S ${o(80, 62, 52)}`)}
      {drawing(EMPTY, kind, '')}
    </Svg>
  );
}
