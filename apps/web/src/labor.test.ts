import { describe, expect, it } from 'vitest';
import { employmentShare, parseCityLabor, staffByCity } from './labor';

const day = {
  city_id: 'c1',
  game_day: 20000,
  supply: 40,
  employed: 30,
  unhoused: 6,
  wage_oboles: 7,
  lodging_oboles: 3,
};

describe('marché du travail et personnel (#259)', () => {
  it('lit le marché du jour par cité ; une ligne illisible fait échouer la lecture', () => {
    const labor = parseCityLabor([day]);
    expect(labor?.get('c1')).toEqual({
      gameDay: 20000,
      supply: 40,
      employed: 30,
      unhoused: 6,
      wageOboles: 7,
      lodgingOboles: 3,
    });
    expect(parseCityLabor([{ ...day, wage_oboles: -1 }])).toBeNull();
    expect(parseCityLabor(null)).toBeNull();
  });

  it('taux d’emploi : employés sur offre, au-delà de 1 sous l’emploi ; offre nulle, sans limite', () => {
    const share = (supply: number | null, employed: number) => {
      const labor = parseCityLabor([{ ...day, supply, employed }])?.get('c1');
      return labor ? employmentShare(labor) : undefined;
    };
    expect(share(40, 30)).toBe(0.75);
    expect(share(20, 30)).toBe(1.5);
    expect(share(0, 30)).toBeNull();
    expect(share(null, 30)).toBeNull();
  });

  it('personnel par cité : sites additionnés, hébergement au prix du jour, cités par nom', () => {
    const rows = [
      { site_id: 's1', city_id: 'c1', workers: 4, housed: 4, unhoused: 0 },
      { site_id: 's2', city_id: 'c1', workers: 4, housed: 1, unhoused: 3 },
      { site_id: 's3', city_id: 'c2', workers: 2, housed: 0, unhoused: 2 },
    ];
    const names: Record<string, string> = { c1: 'Kallistè', c2: 'Elaia' };
    const cities = staffByCity(rows, parseCityLabor([day]), (id) => names[id] ?? id);
    expect(cities).toEqual([
      { cityId: 'c2', workers: 2, housed: 0, unhoused: 2, lodgingOboles: null },
      { cityId: 'c1', workers: 8, housed: 5, unhoused: 3, lodgingOboles: 9 },
    ]);
    expect(staffByCity([{ ...rows[0], workers: 1.5 }], null, String)).toBeNull();
    expect(staffByCity([], null, String)).toEqual([]);
  });
});

describe('offre sans limite (#896)', () => {
  it('une ligne à NULL, une à 0 et une ordinaire se lisent ensemble ; 0 reste 0', () => {
    const labor = parseCityLabor([
      { ...day, city_id: 'a', supply: null },
      { ...day, city_id: 'b', supply: 0 },
      { ...day, city_id: 'c', supply: 40 },
    ]);
    expect(labor?.get('a')?.supply).toBeNull();
    expect(labor?.get('b')?.supply).toBe(0);
    expect(labor?.get('c')?.supply).toBe(40);
    expect(parseCityLabor([{ ...day, supply: -1 }])).toBeNull();
  });
});
