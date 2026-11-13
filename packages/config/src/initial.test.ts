import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig } from './index';

describe('jeu de valeurs initial', () => {
  const result = validateConfig(INITIAL_CONFIG);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  const { config } = result;

  it('contient 15 biens, des recettes et les quatre classes de PNJ d’une cité', () => {
    expect(config.goods).toHaveLength(15);
    expect(config.recipes).toHaveLength(15);
    expect(config.npcClasses.map((npcClass) => npcClass.id)).toEqual([
      'thetes',
      'zeugitai',
      'hippeis',
      'pentakosiomedimnoi',
    ]);
    expect(config.cities).toHaveLength(1);
  });

  it('chaque bien est produit par au moins une recette', () => {
    const produced = new Set(config.recipes.flatMap((r) => r.outputs.map((o) => o.goodId)));
    expect(config.goods.filter((good) => !produced.has(good.id))).toEqual([]);
  });

  it('aucun bien n’est une impasse : chacun est demandé par les PNJ ou consommé par une recette', () => {
    const used = new Set([
      ...config.recipes.flatMap((r) => r.inputs.map((i) => i.goodId)),
      ...config.npcClasses.flatMap((c) => c.basket.map((entry) => entry.goodId)),
    ]);
    expect(config.goods.filter((good) => !used.has(good.id))).toEqual([]);
  });

  it('le revenu de chaque classe couvre son panier au prix de référence, sans le dépasser de beaucoup', () => {
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    for (const npcClass of config.npcClasses) {
      const reference = npcClass.basket.reduce(
        (sum, entry) => sum + entry.quantityPerThousand * (price.get(entry.goodId) ?? 0),
        0,
      );
      // Assez pour acheter tout le panier au prix de référence ; pas assez pour financer une flambée des prix.
      expect(npcClass.incomePerThousand).toBeGreaterThanOrEqual(reference);
      expect(npcClass.incomePerThousand).toBeLessThanOrEqual(reference * 1.5);
    }
  });

  it('chaque recette a une capacité d’accumulation d’au moins un jour', () => {
    for (const recipe of config.recipes) {
      expect(recipe.maxAccruedCycles * recipe.durationMinutes).toBeGreaterThanOrEqual(24 * 60);
    }
  });

  it('le blé a une demande finale : la première tranche jouable vend du blé aux PNJ (ticket 9)', () => {
    const city = config.cities[0];
    const wheatPerTick = config.npcClasses.reduce((total, npcClass) => {
      const entry = npcClass.basket.find((candidate) => candidate.goodId === 'wheat');
      const population = city?.population[npcClass.id] ?? 0;
      return total + ((entry?.quantityPerThousand ?? 0) * population) / 1000;
    }, 0);
    expect(wheatPerTick).toBeGreaterThan(0);
    expect(config.recipes.filter((recipe) => recipe.id === 'grow_wheat')).toHaveLength(1);
  });

  it('chaque bien fini est demandé par au moins une classe de PNJ', () => {
    const wanted = new Set(config.npcClasses.flatMap((c) => c.basket.map((entry) => entry.goodId)));
    const unsold = config.goods.filter((good) => good.tier === 'finished' && !wanted.has(good.id));
    expect(unsold).toEqual([]);
  });

  it('aucune transformation ne détruit de valeur au prix de référence', () => {
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    const value = (stacks: { goodId: string; quantity: number }[]) =>
      stacks.reduce((sum, stack) => sum + stack.quantity * (price.get(stack.goodId) ?? 0), 0);
    const losing = config.recipes.filter((r) => value(r.outputs) <= value(r.inputs));
    expect(losing.map((recipe) => recipe.id)).toEqual([]);
  });
});
