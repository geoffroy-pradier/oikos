import { describe, expect, it } from 'vitest';
import { config, recipeOf } from './city';
import { laborCost, median, netInputs, recipeMargins, type DayMeasure } from './measures';

const day = (extra: Partial<DayMeasure> = {}): DayMeasure => ({
  day: 0,
  supply: {},
  basket: {},
  population: {},
  coverage: {},
  flows: {},
  traded: {},
  bought: {},
  labor: {},
  ...extra,
});
const upkeepOf = (recipeId: string) =>
  config.sites.upkeep.dailyOboles[recipeOf(recipeId).siteType] ?? 0;
const perDay = (recipeId: string) => 1440 / recipeOf(recipeId).durationMinutes;

describe('laborCost', () => {
  it('salaire moyen des jours connus, hébergement au prorata des employés sans logement', () => {
    const days = [
      day({ labor: { a: { wage: 4, lodging: 3, employed: 10, unhoused: 5 } } }),
      day({ labor: { a: { wage: 6, lodging: 1, employed: 10, unhoused: 0 } } }),
      day(),
    ];
    // (3 × 5 + 1 × 0) ÷ 20 employés-jours
    expect(laborCost(days, 'a')).toEqual({ wage: 5, lodging: 0.75 });
    expect(laborCost(days, 'b')).toEqual({ wage: 0, lodging: 0 });
  });
});

describe('recipeMargins', () => {
  // Kallistè : du blé à 5 et de la farine à 12 échangés sur son marché ; les maisons y ont payé leur blé 7.
  const traded = {
    kalliste: {
      wheat: { turnover: 500, volume: 100 },
      flour: { turnover: 1200, volume: 100 },
    },
  };
  const bought = { kalliste: { wheat: { turnover: 350, volume: 50 } } };
  const labor = { kalliste: { wage: 4, lodging: 2, employed: 10, unhoused: 5 } };
  const margins = recipeMargins([day({ traded, bought, labor })]);
  const worker = 4 + (2 * 5) / 10;

  it('matière première : ventes au prix moyen, moins entretien, salaires et part d’hébergement', () => {
    const field = recipeOf('grow_wheat');
    const sales = (field.outputs[0]?.quantity ?? 0) * 5 * perDay('grow_wheat');
    expect(margins['kalliste']?.['grow_wheat']).toBe(
      Math.round(sales - upkeepOf('grow_wheat') - field.workers * worker),
    );
  });

  it('atelier : intrants au prix payé par les maisons, pas au prix moyen des échanges', () => {
    const mill = recipeOf('mill_flour');
    const flour = (mill.outputs[0]?.quantity ?? 0) * 12;
    const wheat = (mill.inputs[0]?.quantity ?? 0) * 7;
    expect(margins['kalliste']?.['mill_flour']).toBe(
      Math.round(
        (flour - wheat) * perDay('mill_flour') - upkeepOf('mill_flour') - mill.workers * worker,
      ),
    );
  });

  it('intrant sans achat de maison dans la cité : ses échanges, avant les achats du monde', () => {
    const bake = recipeOf('bake_bread');
    const [mine, world] = [
      recipeMargins([day({ traded, labor })])['kalliste']?.['bake_bread'],
      recipeMargins([
        day({ traded, labor, bought: { world: { flour: { turnover: 2000, volume: 100 } } } }),
      ])['kalliste']?.['bake_bread'],
    ];
    expect(world).toBe(mine);
    expect(bake.inputs.map((stack) => stack.goodId)).toContain('flour');
  });

  it('sans échange : prix du monde, sinon prix de référence ; matières premières du seul terroir', () => {
    const press = recipeOf('press_oil');
    const reference = (goodId: string) =>
      config.goods.find((good) => good.id === goodId)?.referencePriceOboles ?? 0;
    const value = (stacks: readonly { goodId: string; quantity: number }[]) =>
      stacks.reduce((sum, stack) => sum + stack.quantity * reference(stack.goodId), 0);
    // Elaia n'a ni échange ni marché du travail : pas de salaire connu.
    expect(margins['elaia']?.['press_oil']).toBe(
      Math.round(
        (value(press.outputs) - value(press.inputs)) * perDay('press_oil') - upkeepOf('press_oil'),
      ),
    );
    expect(margins['elaia']?.['catch_fish']).toBeUndefined();
    expect(margins['halos']?.['catch_fish']).toBeDefined();
  });

  it('monde : toutes les recettes, aux prix et au marché du travail du monde', () => {
    const world = recipeMargins([
      day({
        traded: { world: traded.kalliste },
        bought: { world: bought.kalliste },
        labor: { world: labor.kalliste },
      }),
    ])['world'];
    expect(world?.['mill_flour']).toBe(margins['kalliste']?.['mill_flour']);
    expect(world?.['grow_wheat']).toBe(margins['kalliste']?.['grow_wheat']);
    expect(Object.keys(world ?? {}).sort()).toEqual(config.recipes.map((r) => r.id).sort());
  });
});

describe('median', () => {
  it('valeur du milieu, ou moyenne des deux du milieu', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });
});

describe('netInputs', () => {
  it('intrants d’un jour de cycles pleins que les maisons ne produisent pas elles-mêmes', () => {
    const mill = recipeOf('mill_flour');
    const bakery = recipeOf('bake_bread');
    const field = recipeOf('grow_wheat');
    const inputs = netInputs([
      { name: 'meunier', count: 2, sites: ['grow_wheat', 'mill_flour', 'mill_flour'] },
      { name: 'boulanger', count: 1, sites: ['bake_bread'] },
    ]);
    const daily = (recipe: typeof mill, goodId: string, side: 'inputs' | 'outputs') =>
      (recipe[side].find((stack) => stack.goodId === goodId)?.quantity ?? 0) *
      (1440 / recipe.durationMinutes);
    // Deux moulins par maison boivent plus de blé que son champ n'en récolte ; leur farine nourrit le fournil.
    expect(inputs.get('wheat')).toBe(
      2 * (2 * daily(mill, 'wheat', 'inputs') - daily(field, 'wheat', 'outputs')),
    );
    expect(daily(bakery, 'flour', 'inputs')).toBeLessThan(4 * daily(mill, 'flour', 'outputs'));
    expect(inputs.has('flour')).toBe(false);
    expect(inputs.get('charcoal')).toBe(daily(bakery, 'charcoal', 'inputs'));
    expect(netInputs([])).toEqual(new Map());
  });
});
