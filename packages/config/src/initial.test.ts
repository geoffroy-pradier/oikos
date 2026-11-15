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

  it('chaque recette a une capacité d’accumulation d’un à sept jours', () => {
    for (const recipe of config.recipes) {
      expect(recipe.maxAccruedCycles * recipe.durationMinutes).toBeGreaterThanOrEqual(24 * 60);
      expect(recipe.maxAccruedCycles * recipe.durationMinutes).toBeLessThanOrEqual(7 * 24 * 60);
    }
  });

  it('chaque type de site a un entretien quotidien, inférieur à son prix d’acquisition', () => {
    const { acquisitionCostOboles, upkeep } = config.sites;
    // Garde-fou de cohérence, pas une formule d'équilibrage : les montants se règlent librement.
    for (const [type, cost] of Object.entries(acquisitionCostOboles)) {
      const daily = upkeep.dailyOboles[type as keyof typeof upkeep.dailyOboles];
      expect(daily).toBeGreaterThan(0);
      expect(daily).toBeLessThan(cost);
    }
    expect(upkeep.coefficientBps).toBeGreaterThan(0);
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

  it('le panier de l’indice des prix est la consommation de référence de Kallistè (5.5)', () => {
    // Six biens principaux, à la consommation d'un jour de la population initiale arrondie à l'unité
    // (#78 : par tick, elle n'est plus que d'une dizaine d'unités, trop peu pour pondérer le panier),
    // soit 97 % de la dépense de référence de la cité. Garde-fou : un panier vide rendrait l'indice inconnu.
    const city = config.cities.find((candidate) => candidate.id === 'kalliste');
    if (!city) throw new Error('kalliste missing');
    const consumed = new Map<string, number>();
    for (const npcClass of config.npcClasses) {
      for (const { goodId, quantityPerThousand } of npcClass.basket) {
        const ticksPerDay = 1440 / config.clock.tickMinutes;
        const eaten =
          (quantityPerThousand * (city.population[npcClass.id] ?? 0) * ticksPerDay) / 1000;
        consumed.set(goodId, (consumed.get(goodId) ?? 0) + eaten);
      }
    }
    const { basket } = config.priceIndex;
    expect(basket.map((entry) => entry.goodId)).toEqual([
      'wheat',
      'bread',
      'fish',
      'salt',
      'olive_oil',
      'wine',
    ]);
    for (const { goodId, quantity } of basket) {
      expect([goodId, quantity]).toEqual([goodId, Math.round(consumed.get(goodId) ?? 0)]);
    }
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    const spend = (entries: [string, number][]) =>
      entries.reduce((sum, [goodId, quantity]) => sum + quantity * (price.get(goodId) ?? 0), 0);
    const share = spend(basket.map((e) => [e.goodId, e.quantity])) / spend([...consumed]);
    expect(Math.round(share * 100)).toBe(97);
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
