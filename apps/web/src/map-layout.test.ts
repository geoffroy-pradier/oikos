// @vitest-environment node
import { CITY_MAP_POSITIONS } from '@oikos/config/client';
import { describe, expect, it } from 'vitest';
import fr from './locales/fr.json';
import {
  crosses,
  along,
  archipelagoLayout,
  cityDot,
  cityLabels,
  MAP_HEIGHT,
  MAP_WIDTH,
  placeBoxes,
  placeLabels,
  scaleBar,
  type Box,
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

  it('noms des douze cités (#707) : sans chevauchement, hors des boutons, à 360 px comme à 1 440 px', () => {
    const layout = archipelagoLayout(Object.keys(CITY_MAP_POSITIONS), CITY_MAP_POSITIONS);
    const cities = [...layout].map(([slug, at]) => ({
      at,
      name: (fr.cities as Record<string, string>)[slug] ?? slug,
    }));
    const overlap = (a: Box, b: Box) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    // Largeur du dessin en pixels CSS : téléphone de 360 px (et plus étroit), puis ordinateur.
    for (const width of [326, 328, 600, 623, 900]) {
      const unit = MAP_WIDTH / width;
      const controls = { x: MAP_WIDTH - 56 * unit, y: 0, width: 56 * unit, height: 148 * unit };
      const names = cityLabels(cities, unit, [controls]);
      names.forEach((name, i) => {
        const label = `${width} px, ${cities[i]?.name}`;
        expect(name.x, label).toBeGreaterThanOrEqual(0);
        expect(name.y, label).toBeGreaterThanOrEqual(0);
        expect(name.x + name.width, label).toBeLessThanOrEqual(MAP_WIDTH);
        expect(name.y + name.height, label).toBeLessThanOrEqual(MAP_HEIGHT);
        expect(overlap(name, controls), label).toBe(false);
        for (const [j, other] of names.entries())
          if (j !== i) expect(overlap(name, other), `${label} / ${cities[j]?.name}`).toBe(false);
        for (const { at } of cities) expect(overlap(name, cityDot(at, unit)), label).toBe(false);
      });
      // Sur ordinateur, chaque nom est au-dessus de sa cité.
      if (width >= 600)
        names.forEach((name, i) => expect(name.y + name.height).toBeLessThan(cities[i]?.at.y ?? 0));
    }
  });

  it('un nom sans place au-dessus passe dessous, puis à droite, puis à gauche ; sans place du tout, au-dessus', () => {
    const unit = 0.1;
    const at = { x: 50, y: 35 };
    const name = 'Delos';
    const [above] = cityLabels([{ at, name }], unit);
    expect(above).toMatchObject({ y: 35 - 0.8 - 1.7, width: 4.5 });
    // Un fil à l'emplacement de chaque place, l'une après l'autre.
    const wire = (x: number, y: number) => ({ x, y, width: 0.1, height: 0.1 });
    const [under] = cityLabels([{ at, name }], unit, [wire(50, 33)]);
    expect(under?.y).toBeCloseTo(35.8);
    const [right] = cityLabels([{ at, name }], unit, [wire(50, 33), wire(50, 37)]);
    expect(right?.x).toBeCloseTo(50.8);
    const [left] = cityLabels([{ at, name }], unit, [wire(50, 33), wire(50, 37), wire(53, 35)]);
    expect(left?.x).toBeCloseTo(50 - 0.8 - 4.5);
    const everywhere = { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT };
    expect(cityLabels([{ at, name }], unit, [everywhere])).toEqual([above]);
  });

  it('placeBoxes : la première place libre dans le cadre, sinon rien', () => {
    const bounds = { x: 0, y: 0, width: 10, height: 10 };
    const box = (x: number) => ({ x, y: 0, width: 4, height: 2 });
    expect(placeBoxes([[box(0)], [box(2), box(4)], [box(8), box(1)]], [], bounds)).toEqual([
      box(0),
      box(4),
      null,
    ]);
  });
});

describe('rien ne coupe une route (#869)', () => {
  const route = { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } };

  it('un trait coupe un rectangle qu’il traverse ou touche, pas un rectangle à côté', () => {
    expect(crosses(route, { x: 4, y: 4, width: 2, height: 2 })).toBe(true);
    expect(crosses(route, { x: 4, y: 0, width: 2, height: 2 })).toBe(false);
    // Un trait vertical, et un rectangle qui touche son bout.
    expect(
      crosses({ a: { x: 5, y: 0 }, b: { x: 5, y: 10 } }, { x: 4, y: 3, width: 2, height: 1 }),
    ).toBe(true);
    expect(crosses(route, { x: 10, y: 10, width: 1, height: 1 })).toBe(true);
    expect(crosses(route, { x: 11, y: 11, width: 1, height: 1 })).toBe(false);
  });

  it('une étiquette prend la première place qui ne coupe aucune route ; sans place, aucune', () => {
    const bounds = { x: 0, y: 0, width: 20, height: 20 };
    const onRoute = { x: 4, y: 4, width: 2, height: 2 };
    const beside = { x: 6, y: 1, width: 2, height: 2 };
    expect(placeBoxes([[onRoute, beside]], [], bounds, [route])).toEqual([beside]);
    expect(placeBoxes([[onRoute]], [], bounds, [route])).toEqual([null]);
    // Sans route, la première place.
    expect(placeBoxes([[onRoute, beside]], [], bounds)).toEqual([onRoute]);
  });

  it('un nom de cité évite les routes, puis les coupe plutôt que de chevaucher un autre nom', () => {
    // Une cité au centre, une route qui passe juste au-dessus d'elle : le nom passe dessous.
    const at = { x: 50, y: 35 };
    const above = { a: { x: 0, y: 33 }, b: { x: 100, y: 33 } };
    const [name] = cityLabels([{ at, name: 'Elaia' }], 0.1, [], [above]);
    expect(name && name.y).toBeGreaterThan(at.y);
    // Des routes tout autour : le nom reprend la première place, au-dessus.
    const around = [
      above,
      { a: { x: 0, y: 37 }, b: { x: 100, y: 37 } },
      { a: { x: 47, y: 0 }, b: { x: 47, y: 70 } },
      { a: { x: 53, y: 0 }, b: { x: 53, y: 70 } },
    ];
    const [crowded] = cityLabels([{ at, name: 'Elaia' }], 0.1, [], around);
    expect(crowded && crowded.y + crowded.height).toBeLessThanOrEqual(at.y);
  });
});
