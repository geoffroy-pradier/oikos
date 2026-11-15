import { describe, expect, it } from 'vitest';
import {
  aiMonthlyCapMicroEuros,
  DEFAULT_AI,
  DEFAULT_MARKET_TAX,
  DEFAULT_PRICE_HISTORY,
  DEFAULT_POPULATION_DYNAMICS,
  DEFAULT_PRICE_INDEX,
  DEFAULT_SITES,
  DEFAULT_TELEMETRY,
  DEFAULT_UPKEEP,
  validateConfig,
  type GameConfig,
} from './index';

const clone = () => structuredClone(FIXTURE);
function usage() {
  return {
    enabled: false,
    model: 'small',
    timeoutMs: 5_000,
    maxOutputTokens: 300,
    capShareBps: 0,
    inputMicroEurosPerThousandTokens: 150,
    outputMicroEurosPerThousandTokens: 600,
  };
}
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
  market: { npcMaxPriceFactor: 3 },
  marketTax: { rateBps: 400, burnShareBps: 2500 },
  priceHistory: { candleMinutes: 15, referenceWindowHours: 48 },
  populationDynamics: {
    vitalCoverageThresholdBps: 8_000,
    growthBps: 50,
    emigrationBps: 150,
    minShareBps: 4_000,
    maxShareBps: 30_000,
  },
  priceIndex: {
    windowDays: 14,
    inflationTargetBps: { min: -50, max: 250 },
    basket: [{ goodId: 'bread', quantity: 2 }],
  },
  telemetry: { retentionDays: 30 },
  ai: {
    budgetMicroEurosPerActivePlayerMonth: 80_000,
    expectedActivePlayers: 200,
    stewardDailyQuotaPerHouse: 3,
    usages: {
      oracle: { ...usage(), enabled: true, capShareBps: 2_500 },
      chronicle: { ...usage(), capShareBps: 5_000 },
      steward: { ...usage(), capShareBps: 2_500 },
    },
  },
  starting: { grantOboles: 3000, siteRecipeId: 'grow_wheat' },
  sites: {
    limitByHeadquartersLevel: [2, 5],
    acquisitionCostOboles: {
      field: 500,
      orchard: 510,
      pasture: 520,
      forest: 530,
      quarry: 540,
      fishery: 550,
      workshop: 560,
    },
    upkeep: {
      coefficientBps: 12_500,
      dailyOboles: {
        field: 20,
        orchard: 21,
        pasture: 22,
        forest: 23,
        quarry: 24,
        fishery: 25,
        workshop: 26,
      },
    },
  },
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
      maxAccruedCycles: 18,
    },
    {
      id: 'mill_flour',
      siteType: 'workshop',
      inputs: [{ goodId: 'wheat', quantity: 10 }],
      outputs: [{ goodId: 'flour', quantity: 8 }],
      durationMinutes: 60,
      workers: 2,
      maxAccruedCycles: 72,
    },
  ],
  npcClasses: [
    {
      id: 'thetes',
      qualitySensitivity: 0.1,
      incomePerThousand: 600,
      basket: [{ goodId: 'bread', need: 'vital', quantityPerThousand: 30 }],
    },
    {
      id: 'hippeis',
      qualitySensitivity: 0.6,
      incomePerThousand: 600,
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
    const { goods, recipes, cities, clock } = result.config as GameConfig;
    expect(() => void (at(goods, 0).elasticity = 9)).toThrow(TypeError);
    expect(() => void (at(at(recipes, 0).outputs, 0).quantity = 9)).toThrow(TypeError);
    expect(() => void (at(cities, 0).population['thetes'] = 0)).toThrow(TypeError);
    expect(() => void (clock.tickMinutes = 1)).toThrow(TypeError);
    expect(() => goods.push(at(goods, 0))).toThrow(TypeError);
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

  it('horloge : une saison dure au plus une année, bien en deçà des entiers de la base', () => {
    const config = clone();
    config.clock.seasonDays = 366;
    expect(errorsOf(config)).toEqual([]);
    for (const days of [367, 2 ** 31, 0, 7.5]) {
      config.clock.seasonDays = days;
      expect([days, errorsOf(config).map((e) => e.split(':')[0])]).toEqual([
        days,
        ['clock.seasonDays'],
      ]);
    }
  });

  it('horloge : fuseau inexistant, tick qui ne divise pas la journée', () => {
    for (const timezone of ['Mars/Olympus', ' ', 'Europe/Paris ']) {
      const config = clone();
      config.clock.timezone = timezone;
      expect(errorsOf(config)).toEqual(['clock.timezone: unknown IANA time zone']);
    }
    const config = clone();
    config.clock.tickMinutes = 7;
    expect(errorsOf(config)).toEqual([
      'clock.tickMinutes: must divide the 1440 minutes of a day',
      'clock.tickMinutes: must divide the 60 minutes of an hour',
    ]);
    // 90 et 120 minutes divisent la journée mais pas l'heure : la clôture ne tomberait qu'une saison sur deux.
    for (const minutes of [90, 120, 720]) {
      config.clock.tickMinutes = minutes;
      expect(errorsOf(config)).toEqual([
        'clock.tickMinutes: must divide the 60 minutes of an hour',
      ]);
    }
  });

  it('recette qui consomme ce qu’elle produit, ou cite deux fois un bien', () => {
    const config = clone();
    const mill = at(config.recipes, 1);
    mill.outputs.push({ goodId: 'wheat', quantity: 100 });
    mill.inputs.push({ goodId: 'wheat', quantity: 1 });
    expect(errorsOf(config)).toEqual([
      'recipes[1].outputs[1].goodId: good "wheat" is both consumed and produced',
      'recipes[1].inputs: duplicate good "wheat"',
    ]);
  });

  it('panier qui compte deux fois le même bien', () => {
    const config = clone();
    const basket = at(config.npcClasses, 0).basket;
    basket.push({ ...at(basket, 0) });
    expect(errorsOf(config)).toEqual(['npcClasses[0].basket: duplicate good "bread"']);
  });

  it('classe manquante, même quand son identifiant est une propriété héritée des objets', () => {
    const config = clone();
    at(config.npcClasses, 0).id = 'constructor';
    expect(errorsOf(config)).toEqual([
      'cities[0].population.thetes: unknown NPC class "thetes"',
      'cities[0].population: missing NPC class "constructor"',
    ]);
  });

  it('valeurs non finies, montant hors des entiers sûrs, quantité nulle', () => {
    const config = clone();
    at(config.goods, 0).elasticity = Number.NaN;
    at(config.goods, 1).referencePriceOboles = Number.MAX_SAFE_INTEGER + 2;
    at(at(config.recipes, 0).outputs, 0).quantity = 0;
    expect(errorsOf(config).map((error) => error.split(':')[0])).toEqual([
      'goods[0].elasticity',
      'goods[1].referencePriceOboles',
      'recipes[0].outputs[0].quantity',
    ]);
  });

  it('revenu de classe, capacité de site et prix de réserve : obligatoires, entiers positifs ou bornés', () => {
    const missing = clone() as unknown as {
      npcClasses: Record<string, unknown>[];
      recipes: Record<string, unknown>[];
      market: Record<string, unknown>;
    };
    delete at(missing.npcClasses, 0)['incomePerThousand'];
    delete at(missing.recipes, 0)['maxAccruedCycles'];
    delete missing.market['npcMaxPriceFactor'];
    expect(errorsOf(missing).map((error) => error.split(':')[0])).toEqual([
      'market.npcMaxPriceFactor',
      'recipes[0].maxAccruedCycles',
      'npcClasses[0].incomePerThousand',
    ]);
    for (const bad of [0, -5, 764.5, Number.NaN]) {
      const config = clone();
      at(config.npcClasses, 0).incomePerThousand = bad;
      at(config.recipes, 0).maxAccruedCycles = bad;
      expect(errorsOf(config).map((error) => error.split(':')[0])).toEqual([
        'recipes[0].maxAccruedCycles',
        'npcClasses[0].incomePerThousand',
      ]);
    }
    for (const bad of [0.5, 0, 101, Number.NaN]) {
      const config = clone();
      config.market.npcMaxPriceFactor = bad;
      expect(errorsOf(config)).toEqual([expect.stringMatching(/^market\.npcMaxPriceFactor: /)]);
    }
  });

  it('dotation de départ : montant entier positif, recette connue et sans intrant', () => {
    for (const bad of [0, -1, 2.5]) {
      const config = clone();
      config.starting.grantOboles = bad;
      expect(errorsOf(config)).toEqual([expect.stringMatching(/^starting\.grantOboles: /)]);
    }
    const unknown = clone();
    unknown.starting.siteRecipeId = 'grow_gold';
    expect(errorsOf(unknown)).toEqual(['starting.siteRecipeId: unknown recipe "grow_gold"']);
    const workshop = clone();
    workshop.starting.siteRecipeId = 'mill_flour';
    expect(errorsOf(workshop)).toEqual([
      'starting.siteRecipeId: the starting site must run a recipe without inputs',
    ]);
    const missing: Partial<GameConfig> = clone();
    delete missing.starting;
    expect(errorsOf(missing)).toEqual([expect.stringMatching(/^starting: /)]);
    for (const field of ['grantOboles', 'siteRecipeId'] as const) {
      const partial = clone() as unknown as { starting: Record<string, unknown> };
      partial.starting = Object.fromEntries(
        Object.entries(partial.starting).filter(([key]) => key !== field),
      );
      expect(errorsOf(partial)).toEqual([
        expect.stringMatching(new RegExp(`^starting\\.${field}: `)),
      ]);
    }
  });

  it('champ inconnu ou section manquante', () => {
    expect(errorsOf({ ...clone(), bonus: 1 })).toEqual([expect.stringMatching(/^\(root\): /)]);
    const withoutClock: Partial<GameConfig> = clone();
    delete withoutClock.clock;
    expect(errorsOf(withoutClock)).toEqual([expect.stringMatching(/^clock: /)]);
  });
});

/** Entretien d'une version publiée avant lui, en toutes lettres : coefficient ×1, rien à payer. */
const NO_UPKEEP = {
  coefficientBps: 10_000,
  dailyOboles: { field: 0, orchard: 0, pasture: 0, forest: 0, quarry: 0, fishery: 0, workshop: 0 },
};

describe('sites', () => {
  it('une version publiée avant l’acquisition de sites reste lisible, avec les valeurs de départ', () => {
    const older: Partial<GameConfig> = clone();
    delete older.sites;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    // Valeurs écrites ici en toutes lettres : elles appartiennent aux versions déjà publiées et ne
    // suivent pas les rééquilibrages de la configuration initiale.
    expect(result.config.sites).toEqual({
      limitByHeadquartersLevel: [4],
      acquisitionCostOboles: {
        field: 600,
        orchard: 900,
        pasture: 700,
        forest: 700,
        quarry: 1200,
        fishery: 800,
        workshop: 1000,
      },
      upkeep: NO_UPKEEP,
    });
  });

  it('une version publiée avant l’entretien reste lisible et ne prélève rien', () => {
    const older = clone() as unknown as { sites: Record<string, unknown> };
    delete older.sites['upkeep'];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.sites.upkeep).toEqual(NO_UPKEEP);
    expect(result.config.sites.acquisitionCostOboles.field).toBe(500);
    expect(Object.isFrozen(DEFAULT_UPKEEP) && Object.isFrozen(DEFAULT_UPKEEP.dailyOboles)).toBe(
      true,
    );
  });

  it('entretien : coefficient de ×0 à ×10, un montant entier positif ou nul par type, sans autre clé', () => {
    const upkeepErrors = (change: (upkeep: Record<string, unknown>) => void) => {
      const config = clone();
      change(config.sites.upkeep as unknown as Record<string, unknown>);
      return errorsOf(config);
    };
    for (const good of [0, 10_000, 100_000])
      expect(upkeepErrors((upkeep) => (upkeep['coefficientBps'] = good))).toEqual([]);
    for (const bad of [-1, 100_001, 0.5, Number.NaN, undefined])
      expect(upkeepErrors((upkeep) => (upkeep['coefficientBps'] = bad))).toEqual([
        expect.stringMatching(/^sites\.upkeep\.coefficientBps: /),
      ]);
    const daily = (value: unknown) =>
      upkeepErrors(
        (upkeep) => ((upkeep['dailyOboles'] as Record<string, unknown>)['quarry'] = value),
      );
    for (const good of [0, 1, 1_000_000_000]) expect(daily(good)).toEqual([]);
    for (const bad of [-1, 2.5, 1_000_000_001, undefined])
      expect(daily(bad)).toEqual([expect.stringMatching(/^sites\.upkeep\.dailyOboles\.quarry: /)]);
    expect(
      upkeepErrors((upkeep) => ((upkeep['dailyOboles'] as Record<string, unknown>)['palace'] = 1)),
    ).toEqual([expect.stringMatching(/^sites\.upkeep\.dailyOboles/)]);
    expect(upkeepErrors((upkeep) => (upkeep['graceDays'] = 2))).toEqual([
      expect.stringMatching(/^sites\.upkeep/),
    ]);
  });

  it('les valeurs par défaut ne se modifient pas en mémoire', () => {
    expect(Object.isFrozen(DEFAULT_SITES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SITES.acquisitionCostOboles)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SITES.limitByHeadquartersLevel)).toBe(true);
  });

  it('refuse une clé inconnue dans la section et plus de dix niveaux de siège', () => {
    const unknown = clone() as unknown as { sites: Record<string, unknown> };
    unknown.sites['surprise'] = 1;
    expect(errorsOf(unknown)).toEqual([expect.stringMatching(/^sites/)]);
    const tall = clone();
    tall.sites.limitByHeadquartersLevel = Array.from({ length: 11 }, () => 4);
    expect(errorsOf(tall)).toEqual([expect.stringMatching(/^sites\.limitByHeadquartersLevel: /)]);
    tall.sites.limitByHeadquartersLevel = Array.from({ length: 10 }, () => 4);
    expect(errorsOf(tall)).toEqual([]);
  });

  it('exige un prix pour chaque type de site, et aucun autre', () => {
    const missing = clone() as unknown as {
      sites: { acquisitionCostOboles: Record<string, number> };
    };
    delete missing.sites.acquisitionCostOboles['quarry'];
    expect(errorsOf(missing)).toEqual([
      expect.stringMatching(/^sites\.acquisitionCostOboles\.quarry: /),
    ]);
    const extra = clone() as unknown as {
      sites: { acquisitionCostOboles: Record<string, number> };
    };
    extra.sites.acquisitionCostOboles['palace'] = 1;
    expect(errorsOf(extra)).toEqual([expect.stringMatching(/^sites\.acquisitionCostOboles/)]);
  });

  it.each([0, -5, 1.5])('refuse un prix ou une limite de %s', (bad) => {
    const cost = clone();
    cost.sites.acquisitionCostOboles.field = bad;
    expect(errorsOf(cost)).toEqual([
      expect.stringMatching(/^sites\.acquisitionCostOboles\.field: /),
    ]);
    const limit = clone();
    limit.sites.limitByHeadquartersLevel = [bad];
    expect(errorsOf(limit)).toEqual([
      expect.stringMatching(/^sites\.limitByHeadquartersLevel\[0\]: /),
    ]);
  });

  it('exige au moins un niveau de siège', () => {
    const none = clone();
    none.sites.limitByHeadquartersLevel = [];
    expect(errorsOf(none)).toEqual([expect.stringMatching(/^sites\.limitByHeadquartersLevel: /)]);
  });
});

describe('taxe de marché', () => {
  it('une version publiée avant la taxe reste lisible et ne taxe rien', () => {
    const older: Partial<GameConfig> = clone();
    delete older.marketTax;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.marketTax).toEqual({ rateBps: 0, burnShareBps: 10_000 });
    expect(Object.isFrozen(DEFAULT_MARKET_TAX)).toBe(true);
  });

  it('taux et part détruite : entiers, bornés, tous deux obligatoires, sans autre clé', () => {
    const bounds = { rateBps: [0, 5000], burnShareBps: [0, 10_000] } as const;
    for (const field of ['rateBps', 'burnShareBps'] as const) {
      const [min, max] = bounds[field];
      for (const good of [min, max]) {
        const config = clone();
        config.marketTax[field] = good;
        expect(errorsOf(config)).toEqual([]);
      }
      for (const bad of [min - 1, max + 1, 12.5, Number.NaN]) {
        const config = clone();
        config.marketTax[field] = bad;
        expect(errorsOf(config)).toEqual([expect.stringMatching(`^marketTax\\.${field}: `)]);
      }
      const partial = clone() as unknown as { marketTax: Record<string, unknown> };
      partial.marketTax = { [field === 'rateBps' ? 'burnShareBps' : 'rateBps']: 0 };
      expect(errorsOf(partial)).toEqual([expect.stringMatching(`^marketTax\\.${field}: `)]);
    }
    const unknown = clone() as unknown as { marketTax: Record<string, unknown> };
    unknown.marketTax['exempt'] = true;
    expect(errorsOf(unknown)).toEqual([expect.stringMatching(/^marketTax/)]);
  });
});

describe('historique des prix', () => {
  it('une version publiée avant l’historique reste lisible, en chandeliers d’une heure', () => {
    const older: Partial<GameConfig> = clone();
    delete older.priceHistory;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.priceHistory).toEqual({ candleMinutes: 60, referenceWindowHours: 24 });
    expect(Object.isFrozen(DEFAULT_PRICE_HISTORY)).toBe(true);
  });

  it('durée d’un chandelier : entière, d’une minute à une journée, obligatoire, sans autre clé', () => {
    for (const good of [1, 15, 1440]) {
      const config = clone();
      config.priceHistory.candleMinutes = good;
      expect(errorsOf(config)).toEqual([]);
    }
    for (const bad of [0, -60, 1441, 7.5, Number.NaN]) {
      const config = clone();
      config.priceHistory.candleMinutes = bad;
      expect(errorsOf(config)).toEqual([expect.stringMatching(/^priceHistory\.candleMinutes: /)]);
    }
    for (const [hours, valid] of [
      [1, true],
      [720, true],
      [0, false],
      [721, false],
      [1.5, false],
    ] as const) {
      const config = clone();
      config.priceHistory.referenceWindowHours = hours;
      expect(errorsOf(config).map((error) => error.split(':')[0])).toEqual(
        valid ? [] : ['priceHistory.referenceWindowHours'],
      );
    }
    // La fenêtre dure au moins un chandelier : une journée de 1440 minutes demande 24 heures, pas 23.
    for (const [candleMinutes, hours, valid] of [
      [1440, 24, true],
      [1440, 23, false],
      [60, 1, true],
      [61, 1, false],
    ] as const) {
      const config = clone();
      config.priceHistory = { candleMinutes, referenceWindowHours: hours };
      expect(errorsOf(config).map((error) => error.split(':')[0])).toEqual(
        valid ? [] : ['priceHistory.referenceWindowHours'],
      );
    }
    // Une version publiée entre les chandeliers et le prix observé : fenêtre de 24 heures.
    const between = validateConfig({ ...clone(), priceHistory: { candleMinutes: 15 } });
    expect(between.ok && between.config.priceHistory).toEqual({
      candleMinutes: 15,
      referenceWindowHours: 24,
    });
    const loose = clone() as unknown as { priceHistory: Record<string, unknown> };
    loose.priceHistory = {};
    expect(errorsOf(loose)).toEqual([expect.stringMatching(/^priceHistory\.candleMinutes: /)]);
    loose.priceHistory = { candleMinutes: 60, candleSeconds: 30 };
    expect(errorsOf(loose)).toEqual([expect.stringMatching(/^priceHistory/)]);
  });
});

describe('dynamique de population', () => {
  it('une version publiée avant la dynamique reste lisible : population constante', () => {
    const older: Partial<GameConfig> = clone();
    delete older.populationDynamics;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.populationDynamics).toEqual({
      vitalCoverageThresholdBps: 10_000,
      growthBps: 0,
      emigrationBps: 0,
      minShareBps: 10_000,
      maxShareBps: 10_000,
    });
    expect(Object.isFrozen(DEFAULT_POPULATION_DYNAMICS)).toBe(true);
  });

  it('chaque champ : entier, borné, obligatoire, sans autre clé', () => {
    const bounds = {
      vitalCoverageThresholdBps: [1, 10_000],
      growthBps: [0, 1_000],
      emigrationBps: [0, 1_000],
      minShareBps: [0, 10_000],
      maxShareBps: [10_000, 100_000],
    } as const;
    for (const field of Object.keys(bounds) as (keyof typeof bounds)[]) {
      const [min, max] = bounds[field];
      for (const good of [min, max]) {
        const config = clone();
        config.populationDynamics[field] = good;
        expect(errorsOf(config)).toEqual([]);
      }
      for (const bad of [min - 1, max + 1, 12.5, Number.NaN]) {
        const config = clone();
        config.populationDynamics[field] = bad;
        expect(errorsOf(config)).toEqual([
          expect.stringMatching(`^populationDynamics\\.${field}: `),
        ]);
      }
      const partial = clone() as unknown as { populationDynamics: Record<string, unknown> };
      partial.populationDynamics = Object.fromEntries(
        Object.entries(partial.populationDynamics).filter(([key]) => key !== field),
      );
      expect(errorsOf(partial)).toEqual([
        expect.stringMatching(`^populationDynamics\\.${field}: `),
      ]);
    }
    const unknown = clone() as unknown as { populationDynamics: Record<string, unknown> };
    unknown.populationDynamics['migration'] = 1;
    expect(errorsOf(unknown)).toEqual([expect.stringMatching(/^populationDynamics/)]);
  });

  it('population d’une classe : au plus 100 millions, limite du calcul exact', () => {
    const config = clone();
    const classId = Object.keys(at(config.cities, 0).population)[0] ?? '';
    at(config.cities, 0).population[classId] = 100_000_000;
    expect(errorsOf(config)).toEqual([]);
    at(config.cities, 0).population[classId] = 100_000_001;
    expect(errorsOf(config)).toEqual([expect.stringMatching(/^cities\[0\]\.population\./)]);
  });
});

describe('rétention de la télémétrie', () => {
  it('une version publiée avant elle reste lisible : 90 jours', () => {
    const older: Partial<GameConfig> = clone();
    delete older.telemetry;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.telemetry).toEqual({ retentionDays: 90 });
    expect(Object.isFrozen(DEFAULT_TELEMETRY)).toBe(true);
  });

  it('au moins deux jours, la Vigie lisant les dernières 24 heures ; au plus dix ans, en jours entiers', () => {
    const errors = (retentionDays: number) =>
      errorsOf({ ...clone(), telemetry: { retentionDays } });
    expect([errors(2), errors(3650)]).toEqual([[], []]);
    for (const wrong of [1, 3651, 7.5])
      expect(errors(wrong)).toEqual([expect.stringMatching(/^telemetry\.retentionDays: /)]);
  });
});

describe('indice des prix', () => {
  it('une version publiée avant l’indice reste lisible : cible de la spécification, panier vide', () => {
    const older: Partial<GameConfig> = clone();
    delete older.priceIndex;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.priceIndex).toEqual({
      windowDays: 30,
      inflationTargetBps: { min: 0, max: 300 },
      basket: [],
    });
    expect(Object.isFrozen(DEFAULT_PRICE_INDEX)).toBe(true);
  });

  it('fenêtre et cible bornées, panier de biens connus, entiers et sans doublon', () => {
    const errors = (patch: Partial<GameConfig['priceIndex']>) =>
      errorsOf({ ...clone(), priceIndex: { ...clone().priceIndex, ...patch } });
    const bread = { goodId: 'bread', quantity: 2 };
    expect(errors({ windowDays: 365, inflationTargetBps: { min: 300, max: 300 } })).toEqual([]);
    expect(errors({ windowDays: 0 })).toEqual([expect.stringMatching(/^priceIndex\.windowDays: /)]);
    expect(errors({ inflationTargetBps: { min: 301, max: 300 } })).toEqual([
      'priceIndex.inflationTargetBps: min must not exceed max',
    ]);
    expect(errors({ basket: [bread, { goodId: 'nectar', quantity: 1 }] })).toEqual([
      'priceIndex.basket[1].goodId: unknown good "nectar"',
    ]);
    expect(errors({ basket: [bread, bread] })).toEqual([
      'priceIndex.basket: duplicate good "bread"',
    ]);
    expect(errors({ basket: [{ goodId: 'bread', quantity: 1.5 }] })).toEqual([
      expect.stringMatching(/^priceIndex\.basket\[0\]\.quantity: /),
    ]);
  });
});

describe('passerelle IA', () => {
  it('une version publiée avant elle reste lisible : tous les usages coupés, budget nul', () => {
    const older: Partial<GameConfig> = clone();
    delete older.ai;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.ai).toEqual(DEFAULT_AI);
    expect(Object.values(result.config.ai.usages).map((entry) => entry.enabled)).toEqual([
      false,
      false,
      false,
    ]);
    expect(Object.isFrozen(DEFAULT_AI)).toBe(true);
  });

  it('plafond mensuel : budget par joueur × joueurs attendus × part de l’usage, à l’unité inférieure', () => {
    const { ai } = clone();
    // 80 000 µ€ (0,08 €) × 200 joueurs = 16 €, dont un quart pour l'oracle.
    expect(aiMonthlyCapMicroEuros(ai, 'oracle')).toBe(4_000_000);
    expect(aiMonthlyCapMicroEuros(ai, 'chronicle')).toBe(8_000_000);
    const odd = { ...ai, budgetMicroEurosPerActivePlayerMonth: 7, expectedActivePlayers: 3 };
    expect(aiMonthlyCapMicroEuros(odd, 'steward')).toBe(5); // 21 × 0,25 = 5,25
    expect(aiMonthlyCapMicroEuros(DEFAULT_AI, 'oracle')).toBe(0);
  });

  it('budget d’au plus 0,10 € par joueur, parts qui ne dépassent pas le tout, prix et délais entiers', () => {
    const errors = (patch: Record<string, unknown>) =>
      errorsOf({ ...clone(), ai: { ...clone().ai, ...patch } });
    expect(errors({ budgetMicroEurosPerActivePlayerMonth: 100_000 })).toEqual([]);
    expect(errors({ budgetMicroEurosPerActivePlayerMonth: 100_001 })).toEqual([
      expect.stringMatching(/^ai\.budgetMicroEurosPerActivePlayerMonth: /),
    ]);
    const { usages } = clone().ai;
    expect(
      errors({ usages: { ...usages, chronicle: { ...usages.chronicle, capShareBps: 5_001 } } }),
    ).toEqual(['ai.usages: the usages may not share more than the whole budget']);
    expect(
      errors({ usages: { ...usages, oracle: { ...usages.oracle, maxOutputTokens: 0 } } }),
    ).toEqual([expect.stringMatching(/^ai\.usages\.oracle\.maxOutputTokens: /)]);
    expect(errors({ usages: { ...usages, oracle: { ...usages.oracle, timeoutMs: 99 } } })).toEqual([
      expect.stringMatching(/^ai\.usages\.oracle\.timeoutMs: /),
    ]);
    expect(
      errors({
        usages: {
          ...usages,
          steward: { ...usages.steward, inputMicroEurosPerThousandTokens: 1.5 },
        },
      }),
    ).toEqual([expect.stringMatching(/^ai\.usages\.steward\.inputMicroEurosPerThousandTokens: /)]);
    expect(errors({ usages: { oracle: usages.oracle, chronicle: usages.chronicle } })).toEqual([
      expect.stringMatching(/^ai\.usages\.steward: /),
    ]);
  });
});
