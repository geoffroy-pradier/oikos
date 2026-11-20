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

/** Colonnes d'un temple, de `x` à `x + w`, du sol `y` jusqu'à `h` plus haut. */
const columns = (x: number, y: number, w: number, h: number, n: number) =>
  Array.from({ length: n }, (_, i) => `M${x + (i * w) / (n - 1)} ${y}v-${h}`).join('');
/** Un pin : un triangle sur son tronc, le pied en (x, y). */
const pine = (x: number, y: number, h: number) =>
  `M${x} ${y - h}l${h / 3} ${h * 0.8}h-${(h * 2) / 3}Z`;
const trunk = (x: number, y: number, h: number) => `M${x} ${y}v-${h * 0.2}`;
/** Créneaux d'un mur de `w` de large dont le chemin de ronde est à (x, y). */
const merlons = (x: number, y: number, w: number) =>
  Array.from({ length: Math.round(w / 6) }, (_, i) => `M${x + 1 + 6 * i} ${y}v-3h3v3`).join('');
/** Pins d'Agrotera : pied et hauteur. */
const PINES = [
  [20, 50, 14],
  [30, 40, 14],
  [42, 38, 14],
  [54, 44, 12],
  [64, 46, 10],
  [86, 44, 13],
  [98, 46, 13],
] as const;
/** Pieds des cyprès de Gamelia, deux par colline. */
const CYPRESSES = [
  [24, 34],
  [33, 32],
  [80, 30.5],
  [89, 30.5],
] as const;
/** Une touffe de myrte : trois boules. */
const myrtle = (x: number, y: number) => o(x - 3, y, 3) + o(x + 3, y, 3) + o(x, y - 3.5, 3.2);

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
  // Dikaia, la juste, cité de Zeus : son temple sur l'acropole.
  dikaia: `
    t M6 58c8-4 16-7 24-8l8-14c4-2 40-2 44 0l8 14c8 1 16 4 24 8Z
    - M42 36v-2.5h36V36${columns(46, 33.5, 28, 11, 6)}
    - M44 22.5h32v-3.5H44Z
    a M43 19h34l-17-8Z
    ${SEA}
    - ${hull(14, 72)}${sail(14, 72)}
    c ${wave(50, 68)}${wave(84, 72)}`,
  // Gamelia, l'île des noces d'Héra : deux collines unies, chacune ses deux cyprès, et leur sanctuaire rond.
  gamelia: `
    t M4 58c6-14 14-26 26-26s18 8 26 14c8-8 16-16 28-16s24 12 32 28Z
    - ${CYPRESSES.map(([x, y]) => `M${x} ${y + 1}v-4`).join('')}
    t ${CYPRESSES.map(([x, y]) => `M${x} ${y - 17}c2.5 3 3.5 7.5 3.5 10.5 0 2.5-1.5 3.5-3.5 3.5s-3.5-1-3.5-3.5c0-3 1-7.5 3.5-10.5Z`).join('')}
    t M47 48h18v-2.5H47Z
    S M48 45.5h16v-7H48Z
    - ${columns(49.5, 45.5, 13, 7, 4)}
    a M48 38.5h16c0-4.4-3.6-7.5-8-7.5s-8 3.1-8 7.5Z
    ${SEA}
    c ${wave(14, 68)}${wave(54, 72)}${wave(94, 67)}`,
  // Delphis, cité d'Apollon : le soleil se lève entre deux falaises, sur un petit temple.
  delphis: `
    a ${o(60, 28, 6.5)}
    l M60 17.5v-4M52.5 21l-3-3M67.5 21l3-3
    t M2 58c10-4 16-14 20-32l10-8 12 4 9 13 7 3 7-3 9-13 12-4 10 12c4 14 10 24 20 30Z
    t M50.5 51.5h19v-3h-19Z
    - ${columns(54, 48.5, 12, 4.5, 3)}M51.5 44h17l-8.5-3.5Z
    ${SEA}
    - ${hull(96, 72)}${sail(96, 72)}
    c ${wave(12, 68)}${wave(52, 72)}`,
  // Agrotera, île d'Artémis chasseresse : des collines boisées sous le croissant.
  agrotera: `
    A ${o(20, 17, 6)}
    S ${o(23, 14.5, 5.2)}
    t M2 58c8-12 18-22 34-22 14 0 24 8 32 14 8-6 16-10 26-10 12 0 20 8 24 18Z
    - ${PINES.map(([x, y, h]) => trunk(x, y, h)).join('')}
    t ${PINES.map(([x, y, h]) => pine(x, y, h)).join('')}
    ${SEA}
    - ${hull(60, 72)}${sail(60, 72)}
    c ${wave(10, 68)}${wave(96, 70)}`,
  // Phrourion, la forteresse d'Arès : un rempart crénelé entre deux tours, sur un roc abrupt.
  phrourion: `
    t M6 58l12-8 10-14 8-4h44l8 4 10 14 16 8Z
    t M40 33v-9h32v9Z
    t M32 33V19h10v14ZM70 33V19h10v14Z
    - ${merlons(40, 24, 32)}${merlons(32, 19, 10)}${merlons(70, 19, 10)}
    I M53 33v-5a3 3 0 0 1 6 0v5Z
    - M37 16V8
    a M37 8l8 2.5-8 2.5Z
    ${SEA}
    - ${hull(94, 72)}${sail(94, 72)}
    c ${wave(10, 68)}${wave(52, 72)}`,
  // Myrrhinè, île d'Aphrodite : une anse basse plantée de myrtes, sous l'étoile du soir.
  myrrhine: `
    A M92 10c.8 4.4 2.6 6.2 7 7-4.4.8-6.2 2.6-7 7-.8-4.4-2.6-6.2-7-7 4.4-.8 6.2-2.6 7-7Z
    t M6 58c8-6 18-12 30-12 10 0 14 6 24 6s16-8 28-8 22 6 28 14Z
    t ${myrtle(28, 44)}${myrtle(42, 46)}${myrtle(80, 42)}${myrtle(94, 44)}
    ${SEA}
    - ${hull(12, 72)}${sail(12, 72)}
    c ${wave(48, 70)}${wave(92, 68)}`,
  // Chalkeia, la forge d'Héphaïstos : un volcan qui fume, son cratère rougeoyant.
  chalkeia: `
    - M51 18c-3-3 2-5-.5-8.5M57 18c3-3.5-1.5-6 1.5-10
    t M4 58c14-4 26-12 34-22l9-14h14l9 14c8 10 20 18 46 22Z
    a M47 22h14l-2.5 4c-3 1.2-6 1.2-9 0Z
    - M50 30l-2 6M58 30l2 5
    t ${walls(88, 54)}
    - ${roof(88, 54)}M95 47v-5
    ${SEA}
    - ${hull(14, 72)}${sail(14, 72)}
    c ${wave(52, 70)}${wave(94, 68)}`,
  // Emporion, le marché d'Hermès : un portique sur le quai, un môle, et des navires.
  emporion: `
    t M2 58c2-5 8-8 16-8h62c5 0 8 1 10 3h24v5Z
    - M22 50h52${columns(26, 50, 44, 9, 9)}
    t M22 41h52l-4-5H26Z
    ${SEA}
    - ${hull(36, 74)}${sail(36, 74)}${hull(64, 72)}
    a ${sail(64, 72)}
    c ${wave(8, 68)}${wave(94, 70)}`,
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
