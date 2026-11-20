// @vitest-environment node
import { CITY_MAP_POSITIONS } from '@oikos/config/client';
import { describe, expect, it } from 'vitest';
import {
  along,
  archipelagoLayout,
  MAP_HEIGHT,
  MAP_WIDTH,
  placeLabels,
  scaleBar,
  voyageProgress,
} from './map-layout';

describe('dessin de l’archipel', () => {
  it('chaque cité a sa place, dans le cadre, la même quel que soit l’ordre de lecture', () => {
    const layout = archipelagoLayout(['kalliste', 'elaia', 'ampelos', 'halos']);
    expect([...layout.keys()]).toEqual(['ampelos', 'elaia', 'halos', 'kalliste']);
    expect(archipelagoLayout(['halos', 'ampelos', 'kalliste', 'elaia'])).toEqual(layout);
    const points = [...layout.values()];
    for (const { x, y } of points) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(MAP_WIDTH);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(MAP_HEIGHT);
    }
    expect(new Set(points.map(({ x, y }) => `${x},${y}`)).size).toBe(4);
  });

  it('douze cités (#706) : aucune cité de repli ne tombe près d’une cité dessinée, ni d’une autre', () => {
    const slugs = [
      ...Object.keys(CITY_MAP_POSITIONS),
      ...[
        'dikaia',
        'gamelia',
        'delphis',
        'agrotera',
        'phrourion',
        'myrrhine',
        'chalkeia',
        'emporion',
      ],
    ];
    const layout = archipelagoLayout(slugs, CITY_MAP_POSITIONS);
    expect(layout.size).toBe(12);
    // Les quatre places dessinées ne bougent pas (millièmes du dessin).
    expect(layout.get('halos')).toEqual({ x: 72, y: 52 });
    const placed = [...layout.entries()];
    // Un nom de cité tient en une dizaine d'unités de large, trois de haut : six unités les séparent au moins.
    for (const [a, p] of placed)
      for (const [b, q] of placed)
        if (a < b)
          expect(Math.hypot(p.x - q.x, p.y - q.y), `${a} / ${b}`).toBeGreaterThanOrEqual(6);
  });

  it('une cité seule est au centre ; aucune cité, aucun point', () => {
    expect(archipelagoLayout(['kalliste']).get('kalliste')).toEqual({ x: 50, y: 35 });
    expect(archipelagoLayout([]).size).toBe(0);
  });

  it('une cité à sa place sur le dessin ; les autres gardent celle de l’ellipse', () => {
    const fallback = archipelagoLayout(['kalliste', 'elaia', 'ampelos', 'halos']);
    const layout = archipelagoLayout(['kalliste', 'elaia', 'ampelos', 'halos'], {
      kalliste: { x: 500, y: 514 },
      delos: { x: 0, y: 0 },
    });
    expect(layout.get('kalliste')).toEqual({ x: 50, y: 36 });
    for (const slug of ['elaia', 'ampelos', 'halos'])
      expect(layout.get(slug)).toEqual(fallback.get(slug));
    expect(layout.has('delos')).toBe(false);
    // Les clés héritées ne sont pas des places.
    expect(archipelagoLayout(['constructor'], {}).get('constructor')).toEqual({ x: 50, y: 35 });
  });

  it('un navire en mer est dessiné à la part du trajet faite, sans sortir de sa route', () => {
    const departed = '2026-11-16T10:00:00Z';
    const arrives = '2026-11-16T14:00:00Z';
    expect(voyageProgress(departed, arrives, new Date('2026-11-16T11:00:00Z'))).toBe(0.25);
    expect(voyageProgress(departed, arrives, new Date('2026-11-16T09:00:00Z'))).toBe(0);
    expect(voyageProgress(departed, arrives, new Date('2026-11-16T20:00:00Z'))).toBe(1);
    expect(voyageProgress('illisible', arrives, new Date())).toBe(1);
    expect(along({ x: 0, y: 0 }, { x: 40, y: 20 }, 0.25)).toEqual({ x: 10, y: 5 });
  });

  it('échelle : la longueur médiane d’une heure de route, pour 1, 2, 4 ou 8 heures', () => {
    const leg = (length: number, hours: number) => ({
      a: { x: 0, y: 0 },
      b: { x: length, y: 0 },
      hours,
    });
    expect(scaleBar([])).toBeNull();
    // 5 unités par heure (médiane de 3, 5 et 9) : 4 heures font 20 unités.
    expect(scaleBar([leg(12, 4), leg(20, 4), leg(36, 4)])).toEqual({ hours: 4, length: 20 });
    expect(scaleBar([leg(10, 1)])).toEqual({ hours: 2, length: 20 });
    // Une heure minuscule : 8 heures au plus ; une heure immense : une heure, à sa vraie longueur.
    expect(scaleBar([leg(1, 10)])).toEqual({ hours: 8, length: 0.8 });
    expect(scaleBar([leg(30, 1)])).toEqual({ hours: 1, length: 30 });
  });

  it('étiquettes des navires : en haut à droite, sinon ailleurs, jamais l’une sur l’autre ni hors du cadre', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 70 };
    const mark = (x: number, y: number) => ({ at: { x, y }, width: 10, height: 3 });
    const [first, second, third] = placeLabels(
      [mark(50, 30), mark(50, 30), mark(50, 30)],
      [],
      bounds,
      1,
    );
    expect(first).toEqual({ x: 51, y: 26, width: 10, height: 3 });
    expect(second).toEqual({ x: 39, y: 26, width: 10, height: 3 });
    expect(third).toEqual({ x: 51, y: 31, width: 10, height: 3 });
    // Au bord droit, à gauche ; un nom de cité en haut à gauche : en bas à gauche.
    expect(placeLabels([mark(95, 30)], [], bounds, 1)[0]?.x).toBe(84);
    const city = { x: 80, y: 20, width: 15, height: 9 };
    expect(placeLabels([mark(95, 30)], [city], bounds, 1)[0]).toMatchObject({ x: 84, y: 31 });
    // Nulle part : sans étiquette.
    expect(placeLabels([mark(5, 2)], [], { x: 0, y: 0, width: 10, height: 4 }, 1)).toEqual([null]);
  });
});
