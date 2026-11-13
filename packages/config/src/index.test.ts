import { describe, expect, it } from 'vitest';
import { validateConfig, type GameConfig } from './index';

const clone = () => structuredClone(FIXTURE);
/** Accès indexé strict : échoue clairement si le jeu d'essai n'a pas la ligne attendue. */
function at<T>(rows: T[], index: number): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`no row at index ${index}`);
  return row;
}
const errorsOf = (candidate: unknown) => {
  const result = validateConfig(candidate);
  return result.ok ? [] : result.errors;
};

/** Jeu d'essai minimal et valide : trois biens, deux recettes, deux classes, une cité. */
const FIXTURE: GameConfig = {
  clock: { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 },
  goods: [
    { id: 'wheat', tier: 'raw', referencePriceOboles: 6, elasticity: 0.4 },
    { id: 'flour', tier: 'intermediate', referencePriceOboles: 10, elasticity: 0.4 },
    { id: 'bread', tier: 'finished', referencePriceOboles: 15, elasticity: 0.3 },
  ],
  recipes: [
    {
      id: 'grow_wheat',
      siteType: 'field',
      inputs: [],
      outputs: [{ goodId: 'wheat', quantity: 40 }],
      durationMinutes: 240,
      workers: 4,
    },
    {
      id: 'mill_flour',
      siteType: 'workshop',
      inputs: [{ goodId: 'wheat', quantity: 10 }],
      outputs: [{ goodId: 'flour', quantity: 8 }],
      durationMinutes: 60,
      workers: 2,
    },
  ],
  npcClasses: [
    {
      id: 'thetes',
      qualitySensitivity: 0.1,
      basket: [{ goodId: 'bread', need: 'vital', quantityPerThousand: 30 }],
    },
    {
      id: 'hippeis',
      qualitySensitivity: 0.6,
      basket: [{ goodId: 'bread', need: 'vital', quantityPerThousand: 26 }],
    },
  ],
  cities: [{ id: 'kalliste', population: { thetes: 6000, hippeis: 1200 } }],
};

describe('une configuration valide', () => {
  it('est acceptée, rendue à l’identique et figée', () => {
    const result = validateConfig(clone());
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config).toEqual(FIXTURE);
    expect(() => {
      (at(result.config.goods as GameConfig['goods'], 0) as { elasticity: number }).elasticity = 9;
    }).toThrow(TypeError);
  });
});

describe('une configuration invalide est refusée avec un message précis', () => {
  it('valeur hors bornes : le chemin désigne la ligne et le champ', () => {
    const config = clone();
    at(config.goods, 2).elasticity = -1;
    config.clock.dailyCloseHour = 24;
    const errors = errorsOf(config);
    expect(errors).toHaveLength(2);
    expect(errors.find((e) => e.startsWith('goods[2].elasticity: '))).toBeDefined();
    expect(errors.find((e) => e.startsWith('clock.dailyCloseHour: '))).toBeDefined();
  });

  it('montant non entier : pas de flottant pour la monnaie', () => {
    const config = clone();
    at(config.goods, 0).referencePriceOboles = 6.5;
    expect(errorsOf(config)).toEqual([
      expect.stringMatching(/^goods\[0\]\.referencePriceOboles: /),
    ]);
  });

  it('référence à un bien inconnu, dans une recette ou un panier', () => {
    const config = clone();
    at(at(config.recipes, 1).inputs, 0).goodId = 'ambrosia';
    at(at(config.npcClasses, 1).basket, 0).goodId = 'nectar';
    expect(errorsOf(config)).toEqual([
      'recipes[1].inputs[0].goodId: unknown good "ambrosia"',
      'npcClasses[1].basket[0].goodId: unknown good "nectar"',
    ]);
  });

  it('identifiant en double', () => {
    const config = clone();
    config.goods.push({ ...at(config.goods, 0) });
    expect(errorsOf(config)).toEqual(['goods: duplicate id "wheat"']);
  });

  it('population : classe inconnue ou manquante', () => {
    const config = clone();
    const population = at(config.cities, 0).population;
    delete population['hippeis'];
    population['helots'] = 10;
    expect(errorsOf(config)).toEqual([
      'cities[0].population.helots: unknown NPC class "helots"',
      'cities[0].population: missing NPC class "hippeis"',
    ]);
  });

  it('champ inconnu ou section manquante', () => {
    expect(errorsOf({ ...clone(), bonus: 1 })).toEqual([expect.stringMatching(/^\(root\): /)]);
    const withoutClock: Partial<GameConfig> = clone();
    delete withoutClock.clock;
    expect(errorsOf(withoutClock)).toEqual([expect.stringMatching(/^clock: /)]);
  });
});
