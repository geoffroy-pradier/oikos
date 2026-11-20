import { describe, expect, it } from 'vitest';
import { CITY_MAP_POSITIONS, cityMapPositionSchema } from './client';
import { INITIAL_CONFIG, type GameConfig } from './index';

describe('place des cités sur le dessin de l’archipel (#696)', () => {
  it('chaque cité de la configuration initiale est dessinée, à sa place distincte des autres (#707)', () => {
    const ids = (INITIAL_CONFIG as GameConfig).cities.map((city) => city.id);
    expect(Object.keys(CITY_MAP_POSITIONS).sort()).toEqual([...ids].sort());
    const places = Object.values(CITY_MAP_POSITIONS).map(({ x, y }) => `${x} ${y}`);
    expect(new Set(places).size).toBe(places.length);
  });

  it('une route ne relie que deux voisines : elle passe loin de toute autre cité du dessin (#707)', () => {
    // Dans le repère du dessin, 1 000 × 700 : un vingtième de sa largeur au moins entre une route et une autre cité.
    const at = (id: string) => {
      const { x, y } = CITY_MAP_POSITIONS[id] ?? { x: NaN, y: NaN };
      return { x, y: (y * 700) / 1000 };
    };
    const gap = (p: { x: number; y: number }, a: typeof p, b: typeof p) => {
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
      );
      return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    };
    for (const { cities: pair } of (INITIAL_CONFIG as GameConfig).ships.routes)
      for (const other of Object.keys(CITY_MAP_POSITIONS))
        if (!pair.includes(other))
          expect(
            gap(at(other), at(pair[0]), at(pair[1])),
            `${pair.join('–')} / ${other}`,
          ).toBeGreaterThan(50);
  });

  it('en millièmes entiers du dessin, sans autre champ', () => {
    expect(cityMapPositionSchema.safeParse({ x: 0, y: 1000 }).success).toBe(true);
    for (const wrong of [
      { x: -1, y: 0 },
      { x: 1001, y: 0 },
      { x: 1.5, y: 0 },
      { x: 1, y: 1, z: 1 },
    ])
      expect(cityMapPositionSchema.safeParse(wrong).success).toBe(false);
  });
});
