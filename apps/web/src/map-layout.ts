/** Un point de la carte, dans le repère de son `viewBox` (`MAP_WIDTH` × `MAP_HEIGHT`). */
export interface Point {
  x: number;
  y: number;
}

export const MAP_WIDTH = 100;
export const MAP_HEIGHT = 70;

/**
 * Place chaque cité sur le dessin de l'archipel : à sa place dans `positions` (millièmes du dessin, par
 * identifiant de configuration, `CITY_MAP_POSITIONS`), sinon par la règle de repli, sur une ellipse dans
 * l'ordre des identifiants de toutes les cités, une cité seule au centre. Mise en page seulement : aucune
 * distance n'y est lue, la durée vient des routes.
 */
export function archipelagoLayout(
  slugs: readonly string[],
  positions: Readonly<Record<string, { x: number; y: number }>> = {},
): Map<string, Point> {
  const sorted = [...new Set(slugs)].sort();
  const centre = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
  const round = (value: number) => Math.round(value * 10) / 10;
  // Première cité en haut, puis dans le sens des aiguilles d'une montre ; marges pour les noms.
  return new Map(
    sorted.map((slug, index) => {
      const placed = Object.hasOwn(positions, slug) ? positions[slug] : undefined;
      if (placed)
        return [
          slug,
          { x: round((placed.x * MAP_WIDTH) / 1000), y: round((placed.y * MAP_HEIGHT) / 1000) },
        ];
      if (sorted.length === 1) return [slug, centre];
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / sorted.length;
      return [
        slug,
        { x: round(centre.x + 36 * Math.cos(angle)), y: round(centre.y + 24 * Math.sin(angle)) },
      ];
    }),
  );
}

/**
 * Part du trajet faite à l'instant `now`, entre 0 (départ) et 1 (arrivée prévue ou passée) : où dessiner
 * un navire en mer. Un trajet de durée nulle ou des dates illisibles le mettent à l'arrivée.
 */
export function voyageProgress(departedAt: string, arrivesAt: string, now: Date): number {
  const start = Date.parse(departedAt);
  const end = Date.parse(arrivesAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

/** Point à la part `progress` du segment de `from` à `to`. */
export const along = (from: Point, to: Point, progress: number): Point => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
});

/**
 * Échelle du dessin, en heures de mer : la longueur médiane d'une heure de route sur le dessin (durée de
 * référence de la configuration), pour 1, 2, 4 ou 8 heures : la première qui atteint 12 unités.
 * Indicative : le dessin ne prétend à aucune distance. `null` sans route dessinée.
 */
export function scaleBar(legs: readonly { a: Point; b: Point; hours: number }[]) {
  const perHour = legs
    .map(({ a, b, hours }) => Math.hypot(b.x - a.x, b.y - a.y) / hours)
    .sort((x, y) => x - y);
  const median = perHour[Math.floor(perHour.length / 2)];
  if (!median) return null;
  const hours = [1, 2, 4, 8].find((count) => count * median >= 12) ?? 8;
  return { hours, length: Math.round(hours * median * 10) / 10 };
}

/** Un rectangle du dessin : coin haut gauche, largeur et hauteur. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
// Deux rectangles qui se touchent ne se chevauchent pas, aux erreurs d'arrondi près.
const EPSILON = 1e-9;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - EPSILON &&
  b.x < a.x + a.width - EPSILON &&
  a.y < b.y + b.height - EPSILON &&
  b.y < a.y + a.height - EPSILON;
const inside = (box: Box, bounds: Box) =>
  box.x >= bounds.x &&
  box.y >= bounds.y &&
  box.x + box.width <= bounds.x + bounds.width &&
  box.y + box.height <= bounds.y + bounds.height;

/**
 * Pose chaque étiquette à la première de ses places candidates qui reste dans `bounds` sans chevaucher les
 * `obstacles` ni une étiquette déjà posée. `null` : aucune place.
 */
export function placeBoxes(
  spots: readonly (readonly Box[])[],
  obstacles: readonly Box[],
  bounds: Box,
): (Box | null)[] {
  const taken = [...obstacles];
  return spots.map((candidates) => {
    const fits = candidates.find(
      (box) => inside(box, bounds) && !taken.some((other) => overlaps(box, other)),
    );
    if (fits) taken.push(fits);
    return fits ?? null;
  });
}

/**
 * Place l'étiquette de chaque repère (un navire en mer) près de lui : en haut à droite, sinon en haut à
 * gauche, en bas à droite, en bas à gauche, à `gap` du repère, la première qui reste dans `bounds` sans
 * chevaucher les `obstacles` (noms des cités) ni une étiquette déjà posée. `null` : aucune place, le
 * repère reste sans étiquette (la liste de l'écran le nomme).
 */
export function placeLabels(
  marks: readonly { at: Point; width: number; height: number }[],
  obstacles: readonly Box[],
  bounds: Box,
  gap: number,
): (Box | null)[] {
  const spots = marks.map(({ at, width, height }) => {
    const [left, right, up, down] = [
      at.x - gap - width,
      at.x + gap,
      at.y - gap - height,
      at.y + gap,
    ];
    return [
      { x: right, y: up, width, height },
      { x: left, y: up, width, height },
      { x: right, y: down, width, height },
      { x: left, y: down, width, height },
    ];
  });
  return placeBoxes(spots, obstacles, bounds);
}

/**
 * Nom d'une cité sur le dessin, en pixels CSS : 14 px en gras, environ 9 px par lettre, sa ligne de base à 13 px
 * du haut de son rectangle ; le point de la cité et son cerne tiennent dans 8 px autour de son centre.
 */
export const CITY_LABEL = { font: 14, perChar: 9, height: 17, baseline: 13, dot: 8 } as const;
const FULL: Box = { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT };

/** Rectangle du point d'une cité, `dot` pixels autour de son centre, à `unit` unités du dessin par pixel. */
export const cityDot = (at: Point, unit: number): Box => ({
  x: at.x - CITY_LABEL.dot * unit,
  y: at.y - CITY_LABEL.dot * unit,
  width: 2 * CITY_LABEL.dot * unit,
  height: 2 * CITY_LABEL.dot * unit,
});

/**
 * Nom de chaque cité sur le dessin (#707) : au-dessus de son point, sinon au-dessous, à droite ou à gauche,
 * la première place qui reste dans le dessin sans chevaucher un autre nom, un point de cité ni les `reserved`
 * (boutons de la carte). Les cités du nord sont posées d'abord, d'ouest en est. Sans place libre, le nom
 * reste au-dessus : il chevauche, mais se lit encore. `unit` : unités du dessin par pixel CSS.
 */
export function cityLabels(
  cities: readonly { at: Point; name: string }[],
  unit: number,
  reserved: readonly Box[] = [],
): Box[] {
  const { perChar, height, dot } = CITY_LABEL;
  const spots = cities.map(({ at, name }) => {
    const [w, h, d] = [name.length * perChar * unit, height * unit, dot * unit];
    return [
      { x: at.x - w / 2, y: at.y - d - h, width: w, height: h },
      { x: at.x - w / 2, y: at.y + d, width: w, height: h },
      { x: at.x + d, y: at.y - h / 2, width: w, height: h },
      { x: at.x - d - w, y: at.y - h / 2, width: w, height: h },
    ];
  });
  const order = cities
    .map((city, index) => ({ ...city.at, index }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(({ index }) => index);
  const placed = placeBoxes(
    order.map((index) => spots[index] ?? []),
    [...reserved, ...cities.map(({ at }) => cityDot(at, unit))],
    FULL,
  );
  const byCity = new Map(order.map((index, rank) => [index, placed[rank]]));
  return spots.map((candidates, index) => byCity.get(index) ?? (candidates[0] as Box));
}
