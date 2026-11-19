import { describe, expect, it } from 'vitest';
import {
  cityStartingRecipeId,
  cityTerroirAdmits,
  DEFAULT_LABOR,
  DEFAULT_NPC_PUBLIC_INCOME_BPS,
  INITIAL_CONFIG,
  validateConfig,
} from './index';

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
    expect(config.cities.map((city) => city.id)).toEqual(['kalliste', 'elaia', 'ampelos', 'halos']);
  });

  it('cinq dieux, dont le protecteur de chaque cité ; toutes les cités ont un port (#250)', () => {
    expect(config.gods.map((god) => god.id)).toEqual([
      'demeter',
      'athena',
      'dionysos',
      'poseidon',
      'apollo',
    ]);
    expect(config.cities.map((city) => [city.id, city.patronGodId, city.hasPort])).toEqual([
      ['kalliste', 'demeter', true],
      ['elaia', 'athena', true],
      ['ampelos', 'dionysos', true],
      ['halos', 'poseidon', true],
    ]);
  });

  it('Charis (#265) : chaque dieu prend la monnaie et les biens de son domaine à leur prix de référence', () => {
    const price = new Map(config.goods.map((good) => [good.id, good.referencePriceOboles]));
    const domains = Object.fromEntries(
      config.gods.map((god) => [god.id, Object.keys(god.charisPerUnit).sort()]),
    );
    expect(domains).toEqual({
      demeter: ['bread', 'flour', 'wheat'],
      athena: ['cloth', 'olive_oil', 'olives'],
      dionysos: ['grapes', 'wine'],
      poseidon: ['fish', 'salt'],
      apollo: [],
    });
    for (const god of config.gods) {
      // Offrir un bien rapporte autant qu'offrir son prix de référence en oboles.
      expect(god.charisPerObole).toBe(1);
      for (const [goodId, rate] of Object.entries(god.charisPerUnit))
        expect(rate).toBe(price.get(goodId));
      // Un déclin lent, de 1 % par jour ; la Charis de cité compte celle des citoyennes telle quelle.
      expect([god.dailyDecayBps, god.cityCharisWeightBps]).toEqual([100, 10_000]);
    }
  });

  it('terroirs et recettes de départ des quatre cités (#250)', () => {
    const terroir = (cityId: string) =>
      [...(config.cities.find((city) => city.id === cityId)?.terroir ?? [])].sort();
    const primary = config.recipes.filter((recipe) => recipe.siteType !== 'workshop');
    // Kallistè garde toutes les matières premières de la phase 1 : le banc de #78 reste tel quel.
    expect(terroir('kalliste')).toEqual(primary.map((recipe) => recipe.id).sort());
    expect(terroir('elaia')).toEqual(['fell_wood', 'grow_olives', 'grow_wheat', 'rake_salt']);
    expect(terroir('ampelos')).toEqual(['catch_fish', 'dig_clay', 'grow_grapes', 'shear_wool']);
    expect(terroir('halos')).toEqual([
      'catch_fish',
      'dig_clay',
      'fell_wood',
      'rake_salt',
      'shear_wool',
    ]);
    expect(config.cities.map((city) => cityStartingRecipeId(config, city.id))).toEqual([
      'grow_wheat',
      'grow_wheat',
      'grow_grapes',
      'catch_fish',
    ]);
  });

  it('aucune des trois nouvelles cités n’a toutes les matières premières du panier de ses PNJ (6.1)', () => {
    // Matières premières d'un bien : lui-même s'il est produit sans intrant, sinon celles de ses intrants.
    const rawOf = (goodId: string, seen = new Set<string>()): string[] => {
      if (seen.has(goodId)) return [];
      seen.add(goodId);
      return config.recipes
        .filter((recipe) => recipe.outputs.some((output) => output.goodId === goodId))
        .flatMap((recipe) =>
          recipe.inputs.length === 0
            ? [goodId]
            : recipe.inputs.flatMap((input) => rawOf(input.goodId, seen)),
        );
    };
    const wanted = new Set(
      config.npcClasses.flatMap((npcClass) =>
        npcClass.basket.flatMap((entry) => rawOf(entry.goodId)),
      ),
    );
    for (const city of config.cities) {
      const grown = new Set(
        config.recipes
          .filter((recipe) => recipe.inputs.length === 0 && cityTerroirAdmits(city, recipe))
          .flatMap((recipe) => recipe.outputs.map((output) => output.goodId)),
      );
      const missing = [...wanted].filter((goodId) => !grown.has(goodId));
      // Kallistè, cité fondatrice, reste autosuffisante jusqu'à #283.
      if (city.id === 'kalliste') expect(missing).toEqual([]);
      else expect(missing.length).toBeGreaterThan(0);
    }
  });

  it('chaque cité a la population de la cité prototype, classe par classe (5.5)', () => {
    const [kalliste, ...others] = config.cities;
    for (const city of others) expect(city.population).toEqual(kalliste?.population);
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

  it('le salaire entre neutre : nul dans chaque cité, en attendant le calibrage (#283)', () => {
    expect(Object.keys(config.staff.dailyWageOboles).sort()).toEqual(
      config.cities.map((city) => city.id).sort(),
    );
    expect(Object.values(config.staff.dailyWageOboles).every((wage) => wage === 0)).toBe(true);
  });

  it('le revenu public des PNJ entre au revenu d’un jour entier, comme l’ancien robinet, en attendant le calibrage (#632, #283)', () => {
    for (const npcClass of config.npcClasses) expect(npcClass.publicIncomeBps).toBe(10_000);
    // Une version publiée avant le paramètre garde le même comportement.
    expect(DEFAULT_NPC_PUBLIC_INCOME_BPS).toBe(10_000);
    // Et la même dans chaque cité, en attendant que #283 vise les importatrices (#657).
    for (const city of config.cities) expect(city.npcPublicIncomeBps).toBe(10_000);
  });

  it('le budget non dépensé des PNJ se reporte, au plus deux unités au prix de réserve (#675)', () => {
    expect(config.market.npcBudgetCarryUnits).toBe(2);
  });

  it('le marché du travail entre neutre : offre sans limite, salaire de base, hébergement nul (#258)', () => {
    expect(config.labor).toEqual(DEFAULT_LABOR);
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

  it('deux classes de navires, sans entretien au départ (#251, paramètres neutres)', () => {
    expect(config.ships.classes.map((shipClass) => shipClass.id)).toEqual([
      'coaster',
      'round_ship',
    ]);
    for (const shipClass of config.ships.classes) expect(shipClass.dailyUpkeepOboles).toBe(0);
  });

  it('deux tailles de logement, sans entretien ni vétusté au départ, dans chaque cité (#256, paramètres neutres)', () => {
    const { sizes, countsByCity } = config.properties;
    expect(sizes.map((size) => size.id)).toEqual(['townhouse', 'tenement']);
    for (const size of sizes) {
      expect([size.id, size.dailyUpkeepOboles, size.dailyWear]).toEqual([size.id, 0, 0]);
      // Une rénovation coûte moins que l'achat.
      expect(size.renovation.oboles).toBeLessThan(size.purchasePriceOboles);
    }
    for (const city of config.cities)
      for (const size of sizes) expect(countsByCity[city.id]?.[size.id]).toBeGreaterThan(0);
  });

  it('métèque trois jours, archonte élu pour 28 jours, au plus deux mandats de suite (3, 6.2 ; #260)', () => {
    expect(config.politics).toEqual({
      meticDays: 3,
      archon: { termDays: 28, candidacyDays: 4, votingDays: 3, maxConsecutiveTerms: 2 },
    });
  });

  it('décrets : quatre modèles ouverts, taux et coefficient autour de ceux du monde (6.3 ; #261)', () => {
    const decrees = config.decrees;
    expect(decrees && Object.keys(decrees.models).sort()).toEqual([
      'festival',
      'market_tax_rate',
      'port_dues',
      'public_works',
    ]);
    const rate = decrees?.models.market_tax_rate;
    expect(rate && rate.minRateBps <= config.marketTax.rateBps).toBe(true);
    expect(rate && config.marketTax.rateBps <= rate.maxRateBps).toBe(true);
    const port = decrees?.models.port_dues;
    for (const coefficient of Object.values(config.ships.portDues.cityCoefficientBps))
      expect(
        port && port.minCoefficientBps <= coefficient && coefficient <= port.maxCoefficientBps,
      ).toBe(true);
  });

  it('une route entre chaque paire de cités, sans provisions ni droit de port au départ (#252)', () => {
    const cities = config.cities.map((city) => city.id);
    const pairs = cities.flatMap((a, i) => cities.slice(i + 1).map((b) => [a, b].sort().join(' ')));
    expect(
      config.ships.routes.map(({ cities: pair }) => [...pair].sort().join(' ')).sort(),
    ).toEqual(pairs.sort());
    for (const route of config.ships.routes)
      expect(Object.values(route.provisionsOboles).every((oboles) => oboles === 0)).toBe(true);
    expect(Object.values(config.ships.portDues.byClassOboles).every((oboles) => oboles === 0)).toBe(
      true,
    );
    for (const city of config.cities)
      expect(config.ships.portDues.cityCoefficientBps[city.id]).toBe(10_000);
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

  it('tous les usages d’IA sont coupés au départ : le jeu se joue sans IA (règle 6, paramètres neutres)', () => {
    expect(Object.values(config.ai.usages).every((usage) => !usage.enabled)).toBe(true);
    expect(config.ai.budgetMicroEurosPerActivePlayerMonth).toBe(0);
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
