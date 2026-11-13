import { describe, expect, it } from 'vitest';
import { INITIAL_CONFIG, validateConfig } from './index';

describe('jeu de valeurs initial', () => {
  const result = validateConfig(INITIAL_CONFIG);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  const { config } = result;

  it('contient 15 biens, des recettes et les quatre classes de PNJ d’une cité', () => {
    expect(config.goods).toHaveLength(15);
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
