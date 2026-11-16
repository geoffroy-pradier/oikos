/** Un point de la carte, dans le repère de son `viewBox` (`MAP_WIDTH` × `MAP_HEIGHT`). */
export interface Point {
  x: number;
  y: number;
}

export const MAP_WIDTH = 100;
export const MAP_HEIGHT = 70;

/**
 * Place les cités sur une ellipse, dans l'ordre de leurs identifiants de configuration : un dessin
 * schématique et stable de l'archipel (la configuration ne porte pas de coordonnées). Une seule cité est
 * au centre. Mise en page seulement : aucune distance n'y est lue, la durée vient des routes.
 */
export function archipelagoLayout(slugs: readonly string[]): Map<string, Point> {
  const sorted = [...new Set(slugs)].sort();
  const centre = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
  if (sorted.length === 1) return new Map([[sorted[0] ?? '', centre]]);
  // Première cité en haut, puis dans le sens des aiguilles d'une montre ; marges pour les noms.
  return new Map(
    sorted.map((slug, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / sorted.length;
      const point = {
        x: Math.round((centre.x + 36 * Math.cos(angle)) * 10) / 10,
        y: Math.round((centre.y + 24 * Math.sin(angle)) * 10) / 10,
      };
      return [slug, point];
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
