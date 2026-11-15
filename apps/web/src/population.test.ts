import { describe, expect, it } from 'vitest';
import { coverageShare, parseCityPopulation } from './population';

describe('population de la cité', () => {
  it('trie les classes de la plus peuplée à la moins peuplée et fait le total', () => {
    const city = parseCityPopulation([
      { class_id: 'hippeis', population: 900, coverage_bps: 9_500 },
      { class_id: 'thetes', population: 6_000, coverage_bps: 8_700 },
      { class_id: 'metics', population: 50, coverage_bps: null },
      { class_id: 'zeugitai', population: 900, coverage_bps: 9_000 },
    ]);
    expect(city?.classes.map((row) => row.class_id)).toEqual([
      'thetes',
      'hippeis',
      'zeugitai',
      'metics',
    ]);
    expect(city?.total).toBe(7_850);
  });

  it('couverture : fraction pour l’affichage, nulle tant qu’aucune clôture ne l’a mesurée', () => {
    expect(coverageShare({ class_id: 'thetes', population: 1, coverage_bps: 8_700 })).toBe(0.87);
    expect(coverageShare({ class_id: 'thetes', population: 1, coverage_bps: null })).toBeNull();
  });

  it('cité sans état encore : liste vide, total nul', () => {
    expect(parseCityPopulation([])).toEqual({ classes: [], total: 0 });
  });

  it.each([
    ['réponse qui n’est pas une liste', { class_id: 'thetes' }],
    ['population négative', [{ class_id: 'thetes', population: -1, coverage_bps: null }]],
    ['population décimale', [{ class_id: 'thetes', population: 1.5, coverage_bps: null }]],
    ['couverture au-delà de 100 %', [{ class_id: 'thetes', population: 1, coverage_bps: 10_001 }]],
    ['classe sans identifiant', [{ class_id: '', population: 1, coverage_bps: null }]],
    [
      'total au-delà des entiers sûrs',
      [
        { class_id: 'a', population: Number.MAX_SAFE_INTEGER, coverage_bps: null },
        { class_id: 'b', population: 1, coverage_bps: null },
      ],
    ],
  ])('refuse une lecture illisible : %s', (_label, raw) => {
    expect(parseCityPopulation(raw)).toBeNull();
  });
});
