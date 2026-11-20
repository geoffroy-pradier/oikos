import { describe, expect, it } from 'vitest';
import { CITY_MAP_POSITIONS, cityMapPositionSchema } from './client';
import { INITIAL_CONFIG, type GameConfig } from './index';

describe('place des cités sur le dessin de l’archipel (#696)', () => {
  it('chaque cité dessinée est de la configuration initiale, à sa place distincte des autres ; les huit cités de #706 attendent leur île', () => {
    const ids = (INITIAL_CONFIG as GameConfig).cities.map((city) => city.id);
    expect(Object.keys(CITY_MAP_POSITIONS).sort()).toEqual(
      ['ampelos', 'elaia', 'halos', 'kalliste'].sort(),
    );
    for (const placed of Object.keys(CITY_MAP_POSITIONS)) expect(ids).toContain(placed);
    const places = Object.values(CITY_MAP_POSITIONS).map(({ x, y }) => `${x} ${y}`);
    expect(new Set(places).size).toBe(places.length);
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
