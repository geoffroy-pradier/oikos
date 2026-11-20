import { circle as o, drawing, paths, Svg, type IllustrationProps } from './svg';

/** Une barque, sa quille en (x, y) ; sa voile à part, pour pouvoir l'accentuer. */
const hull = (x: number, y: number) => `M${x} ${y}h14l-3 4h-8ZM${x + 7} ${y}v-13`;
const sail = (x: number, y: number) => `M${x + 7} ${y - 13}l7 11h-7Z`;
/** Une vague courte. */
const wave = (x: number, y: number) => `M${x} ${y}c2-2 4-2 6 0s4 2 6 0`;
/** Pieds des oliviers sur la crête d'Elaia. */
const CREST = [
  [28, 48],
  [44, 43],
  [60, 40],
  [76, 40],
  [92, 43],
] as const;
/** Une maison, posée en (x, y) : murs, puis toit. */
const walls = (x: number, y: number) => `M${x} ${y}v-7h9v7Z`;
const roof = (x: number, y: number) => `M${x - 1.5} ${y - 7}l6-5.5 6 5.5Z`;

/** La mer, posée après l'île : elle en efface le pied et dessine le rivage. */
const SEA = 'E M0 56h120v14a10 10 0 0 1-10 10H10A10 10 0 0 1 0 70Z';

/** Salines d'Halos : un damier de bassins vu en perspective, sur 4 colonnes et 2 rangs. */
const PANS = Array.from({ length: 8 }, (_, cell) => {
  const [i, j] = [cell % 4, Math.floor(cell / 4)];
  const at = (u: number, v: number) => `${32 - 10 * v + u * (56 + 20 * v)} ${43 + 10 * v}`;
  const quad = `M${at(i / 4, j / 2)}L${at((i + 1) / 4, j / 2)}L${at((i + 1) / 4, (j + 1) / 2)}L${at(i / 4, (j + 1) / 2)}Z`;
  return `${(i + j) % 2 ? 't' : 'e'} ${quad}`;
}).join('\n');

/**
 * Vignettes des cités, 120 × 80, de profil sur l'horizon : ciel doux, mer, l'île et un motif dominant,
 * une seule touche d'accent (codes de ton : `svg.tsx`). Elles se lisent de 120 à 240 px de large.
 */
const CITIES: Record<string, string> = {
  // Kallistè, la plus belle : un mont, et le bourg sur son port.
  kalliste: `
    t M2 58C14 52 22 40 30 26c3-6 6-12 9-12s5 4 7 7l3-3c2-1 3 0 5 3 5 9 10 17 18 22h29c6 0 12 6 15 14Z
    t ${walls(74, 44)}${walls(86, 44)}${walls(98, 44)}
    - ${roof(74, 44)}${roof(98, 44)}
    a ${roof(86, 44)}
    ${SEA}
    - ${hull(98, 72)}${sail(98, 72)}
    c ${wave(10, 68)}${wave(40, 72)}${wave(70, 66)}`,
  // Elaia, l'île des oliviers : une longue crête et sa rangée d'arbres.
  elaia: `
    a ${o(104, 18, 8)}
    t M2 58c10-6 20-10 32-13 12-3 22-6 34-6s24 4 34 9c7 3 12 6 16 10Z
    - ${CREST.map(([x, y]) => `M${x} ${y}v-5`).join('')}
    t ${CREST.map(([x, y]) => o(x, y - 10, 5.5)).join('')}
    ${SEA}
    c ${wave(14, 68)}${wave(70, 72)}${wave(100, 66)}`,
  // Ampelos, l'île des vignes : un coteau en terrasses plantées.
  ampelos: `
    t M10 58c10-4 18-14 26-26 6-9 14-14 24-14s18 5 24 14c8 12 16 22 26 26Z
    - M26 48c11-3 22-4 34-4s23 1 34 4M33 38c9-2.4 18-3.4 27-3.4s18 1 27 3.4M41 28c6-1.6 12-2.2 19-2.2s13 .6 19 2.2
    - ${[28, 37, 46, 55, 64, 73, 82, 91].map((x) => `M${x} 46v-4`).join('')}
    - ${[38, 47, 56, 65, 74, 83].map((x) => `M${x} 36v-4`).join('')}
    - ${[48, 56, 64, 72].map((x) => `M${x} 26.5v-3.5`).join('')}
    ${SEA}
    - ${hull(4, 70)}
    a ${sail(4, 70)}
    c ${wave(40, 70)}${wave(96, 72)}`,
  // Halos, l'île du sel : un plateau bas couvert de salines, et une barque.
  halos: `
    t M6 56l18-16h72l18 16Z
    t M26 40l5-7 5 7ZM38 40l5-7 5 7ZM78 40l4-5.5 4 5.5Z
    ${PANS}
    ${SEA}
    - ${hull(96, 72)}
    a ${sail(96, 72)}
    c ${wave(10, 68)}${wave(50, 72)}`,
};

/** Repli neutre d'une cité inconnue : une île nue. */
const UNKNOWN_CITY = `
  t M14 58c10-8 22-18 40-18s32 8 46 18Z
  ${SEA}
  c ${wave(10, 68)}${wave(90, 72)}`;

/** Le ciel doux ; chaque dessin pose son île puis la mer. */
const FRAME = `
  S M10 0h100a10 10 0 0 1 10 10v60a10 10 0 0 1-10 10H10A10 10 0 0 1 0 70V10A10 10 0 0 1 10 0Z`;

/** Identifiants des cités dessinées. */
export const CITY_VIGNETTE_IDS = Object.keys(CITIES);

/** Vignette d'une cité (120 × 80 par défaut, `className` pour l'agrandir) ; une cité inconnue reçoit une île nue. */
export function CityVignette({ cityId, ...props }: IllustrationProps & { cityId: string }) {
  return (
    <Svg viewBox="0 0 120 80" width={120} height={80} {...props}>
      {paths(FRAME)}
      {drawing(CITIES, cityId, UNKNOWN_CITY)}
    </Svg>
  );
}
