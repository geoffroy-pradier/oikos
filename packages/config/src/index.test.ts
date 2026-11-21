import { describe, expect, it } from 'vitest';
import {
  aiMonthlyCapMicroEuros,
  npcBudgetCarryUnits,
  cityPortDuesCoefficientBps,
  portDuesBaseOboles,
  routeProvisionsOboles,
  shipRoute,
  DEFAULT_AI,
  DEFAULT_CHAT,
  DEFAULT_CHRONICLE,
  DEFAULT_MODERATION,
  DEFAULT_LABOR,
  cityHasPort,
  cityPublicIncomeBps,
  DEFAULT_CITY_PUBLIC_INCOME_BPS,
  cityStartingRecipeId,
  cityDailyWageOboles,
  cityTerroirAdmits,
  DEFAULT_MARKET_TAX,
  DEFAULT_PRICE_HISTORY,
  DEFAULT_POPULATION_DYNAMICS,
  DEFAULT_PRICE_INDEX,
  DEFAULT_PROPERTIES,
  DEFAULT_SHIPS,
  DEFAULT_SITES,
  DEFAULT_STAFF,
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
  chat: { maxMessageLength: 280, retentionDays: 14, rateLimit: { messages: 5, windowSeconds: 30 } },
  moderation: {
    reportReasons: ['spam', 'other'],
    bannedTerms: ['maudit'],
    maxAppealLength: 600,
    staleReportHours: 12,
    sanctionHours: { warning: [24], silence: [2, 12], suspension: [48] },
  },
  chronicle: { maxGoods: 5, settleSeconds: 120, maxTextLength: 1_500 },
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
  npcHouses: {},
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
  ships: {
    classes: [
      {
        id: 'coaster',
        capacityUnits: 200,
        speedBps: 12_000,
        purchaseCostOboles: 1_800,
        dailyUpkeepOboles: 15,
      },
    ],
    routes: [],
    portDues: { byClassOboles: { coaster: 4 }, burnShareBps: 5_000, cityCoefficientBps: {} },
  },
  staff: { dailyWageOboles: { kalliste: 3 } },
  labor: {
    workingShareBps: {},
    wage: { minBps: 10_000, maxBps: 10_000, slopeBps: 0 },
    lodging: { baseOboles: 0, minBps: 10_000, maxBps: 10_000, slopeBps: 0 },
  },
  properties: {
    sizes: [
      {
        id: 'townhouse',
        purchasePriceOboles: 2_400,
        housingUnits: 4,
        dailyUpkeepOboles: 5,
        dailyWear: 40,
        minHabitableCondition: 2_500,
        renovation: { oboles: 200, goods: [{ goodId: 'wheat', quantity: 3 }] },
      },
    ],
    countsByCity: { kalliste: { townhouse: 8 } },
  },
  politics: {
    meticDays: 2,
    archon: { termDays: 21, candidacyDays: 3, votingDays: 2, maxConsecutiveTerms: 3 },
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
  gods: [
    {
      id: 'demeter',
      charisPerObole: 1,
      charisPerUnit: { wheat: 6, bread: 15 },
      dailyDecayBps: 100,
      cityCharisWeightBps: 10_000,
    },
    {
      id: 'poseidon',
      charisPerObole: 0,
      charisPerUnit: {},
      dailyDecayBps: 0,
      cityCharisWeightBps: 0,
    },
  ],
  graces: [],
  cities: [
    {
      id: 'kalliste',
      population: { thetes: 6000, hippeis: 1200 },
      terroir: ['grow_wheat'],
      hasPort: true,
      patronGodId: 'demeter',
    },
  ],
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

  it('borne du report de budget des PNJ : entier de 2 à 100 unités, absente aucun report (#675)', () => {
    // Absente d'une version publiée avant elle : aucun report, les achats des PNJ ne changent pas.
    expect(npcBudgetCarryUnits(clone().market)).toBe(0);
    for (const units of [2, 3, 100]) {
      const config = clone();
      const result = validateConfig({
        ...config,
        market: { ...config.market, npcBudgetCarryUnits: units },
      });
      if (!result.ok) throw new Error(result.errors.join('\n'));
      expect(npcBudgetCarryUnits(result.config.market)).toBe(units);
    }
    // Une seule unité perdrait de la demande (5.2) ; zéro se dit en omettant le paramètre.
    for (const bad of [-1, 0, 1, 2.5, 101, Number.NaN]) {
      const config = clone();
      expect(
        errorsOf({ ...config, market: { ...config.market, npcBudgetCarryUnits: bad } }),
      ).toEqual([expect.stringMatching(/^market\.npcBudgetCarryUnits: /)]);
    }
  });

  it('multiplicateur de la part publique d’une cité : entier de ×0 à ×2, absent ×1 (#657)', () => {
    // Absent d'une version publiée avant lui : ×1, son revenu public ne change pas.
    expect(DEFAULT_CITY_PUBLIC_INCOME_BPS).toBe(10_000);
    expect(cityPublicIncomeBps(at(clone().cities, 0))).toBe(10_000);
    for (const bps of [0, 1, 20_000]) {
      const config = clone() as GameConfig;
      const city = { ...at(config.cities, 0), npcPublicIncomeBps: bps };
      const result = validateConfig({ ...config, cities: [city] });
      if (!result.ok) throw new Error(result.errors.join('\n'));
      expect(cityPublicIncomeBps(at(result.config.cities, 0))).toBe(bps);
    }
    for (const bad of [-1, 20_001, 1.5, Number.NaN, '10000', null]) {
      const config = clone() as GameConfig;
      const city = { ...at(config.cities, 0), npcPublicIncomeBps: bad };
      expect(errorsOf({ ...config, cities: [city] })).toEqual([
        expect.stringMatching(/^cities\[0\]\.npcPublicIncomeBps: /),
      ]);
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

describe('discussion', () => {
  it('une version publiée avant elle reste lisible : 500 caractères, 30 jours, 10 messages par minute', () => {
    const older: Partial<GameConfig> = clone();
    delete older.chat;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.chat).toEqual({
      maxMessageLength: 500,
      retentionDays: 30,
      rateLimit: { messages: 10, windowSeconds: 60 },
    });
    expect(Object.isFrozen(DEFAULT_CHAT.rateLimit)).toBe(true);
  });

  it('longueur de 1 à 2 000 caractères, plafond de la base ; conservation d’un jour au moins', () => {
    const errors = (chat: Partial<GameConfig['chat']>) =>
      errorsOf({ ...clone(), chat: { ...clone().chat, ...chat } });
    expect([errors({ maxMessageLength: 1 }), errors({ maxMessageLength: 2_000 })]).toEqual([
      [],
      [],
    ]);
    for (const wrong of [0, 2_001, 12.5])
      expect(errors({ maxMessageLength: wrong })).toEqual([
        expect.stringMatching(/^chat\.maxMessageLength: /),
      ]);
    expect([errors({ retentionDays: 1 }), errors({ retentionDays: 3650 })]).toEqual([[], []]);
    for (const wrong of [0, 3651, 1.5])
      expect(errors({ retentionDays: wrong })).toEqual([
        expect.stringMatching(/^chat\.retentionDays: /),
      ]);
  });

  it('débit : au moins un message par fenêtre d’au moins une seconde, au plus un jour', () => {
    const errors = (rateLimit: { messages: number; windowSeconds: number }) =>
      errorsOf({ ...clone(), chat: { ...clone().chat, rateLimit } });
    expect(errors({ messages: 1, windowSeconds: 86_400 })).toEqual([]);
    expect(errors({ messages: 0, windowSeconds: 60 })).toEqual([
      expect.stringMatching(/^chat\.rateLimit\.messages: /),
    ]);
    expect(errors({ messages: 5, windowSeconds: 86_401 })).toEqual([
      expect.stringMatching(/^chat\.rateLimit\.windowSeconds: /),
    ]);
    expect(errorsOf({ ...clone(), chat: { ...clone().chat, extra: 1 } })).not.toEqual([]);
  });
});

describe('modération', () => {
  it('une version publiée avant elle reste lisible : cinq motifs, aucun terme interdit, 1 000 caractères', () => {
    const older: Partial<GameConfig> = clone();
    delete older.moderation;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.moderation).toEqual({
      reportReasons: ['spam', 'harassment', 'hate', 'cheating', 'other'],
      bannedTerms: [],
      maxAppealLength: 1_000,
      staleReportHours: 24,
      sanctionHours: { warning: [168], silence: [1, 24, 72], suspension: [24, 168, 720] },
    });
    expect(Object.isFrozen(DEFAULT_MODERATION.reportReasons)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MODERATION.sanctionHours.silence)).toBe(true);
  });

  it('une version publiée avant les commandes d’administration garde ses motifs et prend les durées par défaut', () => {
    const older: Omit<GameConfig['moderation'], 'sanctionHours'> & { sanctionHours?: unknown } =
      clone().moderation;
    delete older.sanctionHours;
    const result = validateConfig({ ...clone(), moderation: older });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.moderation.reportReasons).toEqual(['spam', 'other']);
    expect(result.config.moderation.sanctionHours).toEqual(DEFAULT_MODERATION.sanctionHours);
  });

  it('durées des sanctions : de une à dix par sorte, distinctes, d’une heure à un an, pas d’exclusion', () => {
    const errors = (sanctionHours: unknown) =>
      errorsOf({ ...clone(), moderation: { ...clone().moderation, sanctionHours } });
    const hours = { warning: [1], silence: [1, 8_760], suspension: [24] };
    expect(errors(hours)).toEqual([]);
    for (const [wrong, path] of [
      [{ ...hours, silence: [] }, 'silence'],
      [{ ...hours, silence: [0] }, 'silence.0'],
      [{ ...hours, silence: [8_761] }, 'silence.0'],
      [{ ...hours, silence: [1.5] }, 'silence.0'],
      [{ ...hours, suspension: [24, 24] }, 'suspension'],
      [{ ...hours, suspension: Array.from({ length: 11 }, (_, i) => i + 1) }, 'suspension'],
    ] as const)
      expect(errors(wrong)).toEqual([
        expect.stringMatching(
          new RegExp(`^moderation\\.sanctionHours\\.${path.replace('.', '\\[')}`),
        ),
      ]);
    expect(errors({ ...hours, ban: [1] })).not.toEqual([]);
    expect(errors({ warning: [1], silence: [1] })).not.toEqual([]);
  });

  it('seuil des signalements en attente : de 1 à 720 heures entières, 24 par défaut', () => {
    const errors = (staleReportHours: unknown) =>
      errorsOf({ ...clone(), moderation: { ...clone().moderation, staleReportHours } });
    expect(errors(1)).toEqual([]);
    expect(errors(720)).toEqual([]);
    for (const wrong of [0, 721, 1.5])
      expect(errors(wrong)).toEqual([expect.stringMatching(/^moderation\.staleReportHours: /)]);
    const older: Partial<GameConfig['moderation']> = clone().moderation;
    delete older.staleReportHours;
    const result = validateConfig({ ...clone(), moderation: older });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.moderation.staleReportHours).toBe(24);
  });

  it('au moins un motif, sans doublon ; des termes qui portent une lettre ou un chiffre ; un appel de 1 à 2 000 caractères', () => {
    const errors = (moderation: Partial<GameConfig['moderation']>) =>
      errorsOf({ ...clone(), moderation: { ...clone().moderation, ...moderation } });
    expect(errors({ maxAppealLength: 2_000 })).toEqual([]);
    expect(errors({ bannedTerms: ['  Gros mot ', 'x1'] })).toEqual([]);
    for (const wrong of [0, 2_001, 1.5])
      expect(errors({ maxAppealLength: wrong })).toEqual([
        expect.stringMatching(/^moderation\.maxAppealLength: /),
      ]);
    expect(errors({ reportReasons: [] })).toEqual([
      expect.stringMatching(/^moderation\.reportReasons: /),
    ]);
    expect(errors({ reportReasons: ['spam', 'spam'] })).toEqual([
      expect.stringMatching(/^moderation\.reportReasons: .*spam/),
    ]);
    expect(errors({ reportReasons: ['Spam'] })).toEqual([
      expect.stringMatching(/^moderation\.reportReasons\[0\]: /),
    ]);
    expect(errors({ bannedTerms: ['ok', ' -- '] })).toEqual([
      expect.stringMatching(/^moderation\.bannedTerms\[1\]: /),
    ]);
    expect(errors({ bannedTerms: [''] })).not.toEqual([]);
  });
});

describe('chronique', () => {
  it('une version publiée avant elle reste lisible : trois biens, une minute, 2 000 caractères', () => {
    const older: Partial<GameConfig> = clone();
    delete older.chronicle;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.chronicle).toEqual({
      maxGoods: 3,
      settleSeconds: 60,
      maxTextLength: 2_000,
    });
    expect(Object.isFrozen(DEFAULT_CHRONICLE)).toBe(true);
  });

  it('de 0 à 20 biens, au plus une heure d’attente, des textes de 200 à 4 000 caractères', () => {
    const errors = (chronicle: Partial<GameConfig['chronicle']>) =>
      errorsOf({ ...clone(), chronicle: { ...clone().chronicle, ...chronicle } });
    const valid = [
      { maxGoods: 0 },
      { maxGoods: 20 },
      { settleSeconds: 0 },
      { settleSeconds: 3_600 },
      { maxTextLength: 200 },
      { maxTextLength: 4_000 },
    ];
    expect(valid.map(errors)).toEqual(valid.map(() => []));
    const wrong: [Partial<GameConfig['chronicle']>, string][] = [
      [{ maxGoods: -1 }, 'maxGoods'],
      [{ maxGoods: 21 }, 'maxGoods'],
      [{ maxGoods: 1.5 }, 'maxGoods'],
      [{ settleSeconds: -1 }, 'settleSeconds'],
      [{ settleSeconds: 3_601 }, 'settleSeconds'],
      [{ maxTextLength: 199 }, 'maxTextLength'],
      [{ maxTextLength: 4_001 }, 'maxTextLength'],
    ];
    for (const [value, key] of wrong)
      expect(errors(value)).toEqual([expect.stringMatching(new RegExp(`^chronicle\\.${key}: `))]);
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
    expect(
      errors({
        usages: { ...usages, oracle: { ...usages.oracle, outputMicroEurosPerThousandTokens: 0 } },
      }),
    ).toEqual([
      'ai.usages.oracle.outputMicroEurosPerThousandTokens: an enabled usage must have a price, or its cap would never be reached',
    ]);
    expect(errors({ usages: { oracle: usages.oracle, chronicle: usages.chronicle } })).toEqual([
      expect.stringMatching(/^ai\.usages\.steward: /),
    ]);
  });
});

describe('personnel (4.4)', () => {
  const withWages = (dailyWageOboles: Record<string, unknown>) => ({
    ...clone(),
    staff: { dailyWageOboles },
  });

  it('une version publiée avant le personnel reste lisible : aucun salaire, dans aucune cité', () => {
    const older: Partial<GameConfig> = clone();
    delete older.staff;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.staff).toEqual(DEFAULT_STAFF);
    expect(cityDailyWageOboles(result.config, 'kalliste')).toBe(0);
    expect(Object.isFrozen(DEFAULT_STAFF)).toBe(true);
    // Une section explicitement vide se lit de même.
    expect(errorsOf(withWages({}))).toEqual([]);
  });

  it('salaire du jour d’une cité : le sien ; nul pour une cité inconnue, même nommée comme une propriété d’objet', () => {
    const { staff } = clone();
    expect(cityDailyWageOboles({ staff }, 'kalliste')).toBe(3);
    expect(cityDailyWageOboles({ staff }, 'elaia')).toBe(0);
    expect(cityDailyWageOboles({ staff }, 'constructor')).toBe(0);
    expect(cityDailyWageOboles({ staff }, 'toString')).toBe(0);
  });

  it('salaire : entier, de 0 à un milliard, pour chaque cité connue et pour elles seules', () => {
    expect(errorsOf(withWages({ kalliste: 0 }))).toEqual([]);
    expect(errorsOf(withWages({ kalliste: 1_000_000_000 }))).toEqual([]);
    for (const bad of [-1, 1.5, 1_000_000_001, '3', null])
      expect(errorsOf(withWages({ kalliste: bad }))).toEqual([
        expect.stringMatching(/^staff\.dailyWageOboles\.kalliste: /),
      ]);
    expect(errorsOf(withWages({ kalliste: 3, elaia: 2 }))).toEqual([
      'staff.dailyWageOboles.elaia: unknown city "elaia"',
    ]);
    const twoCities = {
      ...withWages({ kalliste: 3 }),
      cities: [...clone().cities, { id: 'elaia', population: { thetes: 1, hippeis: 1 } }],
    };
    expect(errorsOf(twoCities)).toEqual(['staff.dailyWageOboles: missing city "elaia"']);
    expect(
      errorsOf({ ...clone(), staff: { dailyWageOboles: { kalliste: 3 }, perDay: 1 } }),
    ).toEqual([expect.stringMatching(/^staff: /)]);
  });
});

describe('personnel : dû d’un jour dans les entiers sûrs', () => {
  // Champ de blé du jeu d'essai : entretien ⌈20 × 1,25⌉ = 25. Salaire d'un milliard à Kallistè.
  const withWorkers = (workers: number) => {
    const config = clone();
    at(config.recipes, 0).workers = workers;
    return { ...config, staff: { dailyWageOboles: { kalliste: 1_000_000_000 } } };
  };
  // Le plus grand nombre de travailleurs dont le dû tient : (2^53 − 1 − 25) ÷ 10^9, arrondi en dessous.
  const most = Math.floor((Number.MAX_SAFE_INTEGER - 25) / 1_000_000_000);

  it('refuse une recette dont le dû d’un jour dépasserait les entiers sûrs dans une cité, à l’unité près', () => {
    expect(errorsOf(withWorkers(most))).toEqual([]);
    expect(errorsOf(withWorkers(most + 1))).toEqual([
      'recipes[0].workers: a day of upkeep, wages and lodging in "kalliste" exceeds the safe integer range',
    ]);
    // Sans salaire, aucun travailleur ne coûte : la borne ne s'applique pas.
    const unpaid = { ...withWorkers(most + 1), staff: { dailyWageOboles: { kalliste: 0 } } };
    expect(errorsOf(unpaid)).toEqual([]);
  });
});

describe('marché du travail et hébergement (#258)', () => {
  const withLabor = (patch: Record<string, unknown>) => ({
    ...clone(),
    labor: { ...structuredClone(DEFAULT_LABOR), ...patch },
  });

  it('une version publiée avant le marché du travail reste lisible : offre sans limite, rien à loger', () => {
    const older: Partial<GameConfig> = clone();
    delete older.labor;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.labor).toEqual(DEFAULT_LABOR);
    expect(Object.isFrozen(DEFAULT_LABOR)).toBe(true);
    expect(errorsOf(withLabor({}))).toEqual([]);
  });

  it('classes travailleuses connues, parts de 0 à 10 000 points', () => {
    expect(errorsOf(withLabor({ workingShareBps: { thetes: 0, hippeis: 10_000 } }))).toEqual([]);
    expect(errorsOf(withLabor({ workingShareBps: { metics: 5_000 } }))).toEqual([
      'labor.workingShareBps.metics: unknown NPC class "metics"',
    ]);
    for (const bad of [-1, 10_001, 0.5])
      expect(errorsOf(withLabor({ workingShareBps: { thetes: bad } }))).toEqual([
        expect.stringMatching(/^labor\.workingShareBps\.thetes: /),
      ]);
  });

  it('courbes : bornes de ×0 à ×10, la basse sous la haute, pente bornée ; champ inconnu refusé', () => {
    const wage = (curve: Record<string, unknown>) =>
      errorsOf(withLabor({ wage: { ...DEFAULT_LABOR.wage, ...curve } }));
    expect(wage({ minBps: 0, maxBps: 100_000, slopeBps: 100_000 })).toEqual([]);
    expect(wage({ minBps: 12_000, maxBps: 11_000 })).toEqual([
      'labor.wage.maxBps: minBps must not exceed maxBps',
    ]);
    expect(wage({ maxBps: 100_001 })).toEqual([expect.stringMatching(/^labor\.wage\.maxBps: /)]);
    expect(wage({ slopeBps: -1 })).toEqual([expect.stringMatching(/^labor\.wage\.slopeBps: /)]);
    expect(wage({ pivotBps: 1 })).toEqual([expect.stringMatching(/^labor\.wage: /)]);
    const lodging = (patch: Record<string, unknown>) =>
      errorsOf(withLabor({ lodging: { ...DEFAULT_LABOR.lodging, ...patch } }));
    expect(lodging({ baseOboles: 12, minBps: 10_000, maxBps: 40_000, slopeBps: 30_000 })).toEqual(
      [],
    );
    expect(lodging({ baseOboles: -1 })).toEqual([
      expect.stringMatching(/^labor\.lodging\.baseOboles: /),
    ]);
    expect(lodging({ minBps: 2, maxBps: 1 })).toEqual([
      'labor.lodging.maxBps: minBps must not exceed maxBps',
    ]);
  });

  it('le dû d’un jour reste dans les entiers sûrs aux bornes hautes du salaire et de l’hébergement', () => {
    // Un travailleur, un milliard d'hébergement à ×10 : 10^10 par travailleur.
    const config = withLabor({
      lodging: { baseOboles: 1_000_000_000, minBps: 0, maxBps: 100_000, slopeBps: 0 },
    });
    const most = Math.floor((Number.MAX_SAFE_INTEGER - 25) / 10_000_000_000);
    at(config.recipes, 0).workers = most;
    expect(errorsOf(config)).toEqual([]);
    at(config.recipes, 0).workers = most + 1;
    expect(errorsOf(config)).toEqual([
      'recipes[0].workers: a day of upkeep, wages and lodging in "kalliste" exceeds the safe integer range',
    ]);
  });
});

describe('dieux et identité des cités (6.1)', () => {
  const city = () => at(clone().cities, 0);
  const withCity = (patch: Record<string, unknown>) => ({
    ...clone(),
    cities: [{ ...city(), ...patch }],
  });
  /** Une production primaire de plus, hors du terroir de la cité du jeu d'essai. */
  const GROW_OLIVES = {
    id: 'grow_olives',
    siteType: 'orchard' as const,
    inputs: [],
    outputs: [{ goodId: 'wheat', quantity: 1 }],
    durationMinutes: 240,
    workers: 1,
    maxAccruedCycles: 18,
  };
  const withOlives = (patch: Record<string, unknown>) => ({
    ...withCity(patch),
    recipes: [...clone().recipes, GROW_OLIVES],
  });

  it('une version publiée avant les quatre cités reste lisible : aucun dieu, terroir ouvert, port', () => {
    const older: Record<string, unknown> = clone();
    delete older['gods'];
    older['cities'] = [{ id: 'kalliste', population: { thetes: 6000, hippeis: 1200 } }];
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.gods).toEqual([]);
    expect(result.config.cities).toEqual([
      { id: 'kalliste', population: { thetes: 6000, hippeis: 1200 } },
    ]);
    const [kalliste] = result.config.cities;
    expect(cityHasPort(kalliste)).toBe(true);
    // Sans terroir, toute recette est admise ; la recette de départ est la commune.
    expect(cityTerroirAdmits(kalliste, GROW_OLIVES)).toBe(true);
    expect(cityStartingRecipeId(result.config, 'kalliste')).toBe('grow_wheat');
  });

  it('dieu : sans doublon ; un dieu protecteur inconnu est refusé', () => {
    expect(errorsOf({ ...clone(), gods: [{ id: 'demeter' }, { id: 'demeter' }] })).toEqual([
      'gods: duplicate id "demeter"',
    ]);
    expect(errorsOf({ ...clone(), gods: [{ id: 'demeter', charis: 1 }] })).toEqual([
      expect.stringMatching(/^gods\[0\]: /),
    ]);
    expect(errorsOf(withCity({ patronGodId: 'hades' }))).toEqual([
      'cities[0].patronGodId: unknown god "hades"',
    ]);
    // Sans liste de dieux, aucun dieu protecteur n'est connu.
    expect(errorsOf({ ...clone(), gods: [] })).toEqual([
      'cities[0].patronGodId: unknown god "demeter"',
    ]);
    expect(errorsOf(withCity({ patronGodId: undefined }))).toEqual([]);
  });

  it('Charis (#265) : un dieu publié avant elle n’accepte rien et ne décline pas ; taux bornés, biens connus', () => {
    const older = validateConfig({ ...clone(), gods: [{ id: 'demeter' }] });
    if (!older.ok) throw new Error(older.errors.join('\n'));
    expect(older.config.gods).toEqual([
      {
        id: 'demeter',
        charisPerObole: 0,
        charisPerUnit: {},
        dailyDecayBps: 0,
        cityCharisWeightBps: 0,
      },
    ]);
    const god = (patch: Record<string, unknown>) => ({
      ...clone(),
      gods: [{ ...clone().gods[0], ...patch }],
    });
    expect(errorsOf(god({ charisPerUnit: { wheat: 6, fish: 12 } }))).toEqual([
      'gods[0].charisPerUnit.fish: unknown good "fish"',
    ]);
    for (const patch of [
      { charisPerUnit: { wheat: 0 } },
      { charisPerUnit: { wheat: 1_000_001 } },
      { charisPerUnit: { wheat: 1.5 } },
      { charisPerObole: -1 },
      { charisPerObole: 1_000_001 },
      { dailyDecayBps: 10_001 },
      { dailyDecayBps: -1 },
      { cityCharisWeightBps: 100_001 },
    ])
      expect(errorsOf(god(patch))).toEqual([expect.stringMatching(/^gods\[0\]\.\w+/)]);
    // Bornes atteintes : tout un jour de Charis perdu, un poids de ×10, un taux d'un million.
    expect(
      errorsOf(
        god({
          charisPerObole: 1_000_000,
          charisPerUnit: { wheat: 1_000_000 },
          dailyDecayBps: 10_000,
          cityCharisWeightBps: 100_000,
        }),
      ),
    ).toEqual([]);
  });

  it('terroir : recettes connues de production primaire, sans doublon ; un atelier y est refusé', () => {
    expect(errorsOf(withCity({ terroir: ['grow_wheat', 'grow_barley'] }))).toEqual([
      'cities[0].terroir[1]: unknown recipe "grow_barley"',
    ]);
    expect(errorsOf(withCity({ terroir: ['grow_wheat', 'grow_wheat'] }))).toEqual([
      'cities[0].terroir: duplicate recipe "grow_wheat"',
    ]);
    expect(errorsOf(withCity({ terroir: ['grow_wheat', 'mill_flour'] }))).toEqual([
      'cities[0].terroir[1]: workshops are admitted in every city',
    ]);
    expect(errorsOf(withCity({ terroir: 'grow_wheat' }))).toEqual([
      expect.stringMatching(/^cities\[0\]\.terroir: /),
    ]);
  });

  it('port : un booléen ; une cité inconnue de la configuration n’en a pas', () => {
    expect(errorsOf(withCity({ hasPort: false }))).toEqual([]);
    expect([cityHasPort({ hasPort: false }), cityHasPort({ hasPort: true })]).toEqual([
      false,
      true,
    ]);
    expect(cityHasPort(undefined)).toBe(false);
    expect(errorsOf(withCity({ hasPort: 'yes' }))).toEqual([
      expect.stringMatching(/^cities\[0\]\.hasPort: /),
    ]);
  });

  it('recette de départ : connue, sans intrant, et dans le terroir de la cité', () => {
    expect(
      errorsOf(withOlives({ terroir: ['grow_olives'], startingRecipeId: 'grow_olives' })),
    ).toEqual([]);
    expect(errorsOf(withCity({ startingRecipeId: 'grow_barley' }))).toEqual([
      'cities[0].startingRecipeId: unknown recipe "grow_barley"',
    ]);
    expect(errorsOf(withCity({ startingRecipeId: 'mill_flour' }))).toEqual([
      'cities[0].startingRecipeId: the starting site must run a recipe without inputs',
    ]);
    // La sienne, hors de son terroir.
    expect(errorsOf(withOlives({ startingRecipeId: 'grow_olives' }))).toEqual([
      'cities[0].startingRecipeId: the starting recipe "grow_olives" is not in the terroir',
    ]);
    // La commune, faute de la sienne, hors de son terroir.
    expect(errorsOf(withOlives({ terroir: ['grow_olives'] }))).toEqual([
      'cities[0].terroir: the starting recipe "grow_wheat" is not in the terroir',
    ]);
    // Terroir vide : seule une cité qui n'a pas de production primaire, refusée faute de départ.
    expect(errorsOf(withCity({ terroir: [] }))).toEqual([
      'cities[0].terroir: the starting recipe "grow_wheat" is not in the terroir',
    ]);
  });

  it('un atelier est admis partout, une production primaire seulement dans son terroir', () => {
    const [mill, wheat] = [at(clone().recipes, 1), at(clone().recipes, 0)];
    expect(cityTerroirAdmits({ terroir: [] }, mill)).toBe(true);
    expect(cityTerroirAdmits({ terroir: [] }, wheat)).toBe(false);
    expect(cityTerroirAdmits({ terroir: ['grow_wheat'] }, wheat)).toBe(true);
    expect(cityTerroirAdmits({ terroir: ['grow_wheat'] }, GROW_OLIVES)).toBe(false);
    // Cité inconnue de la configuration : rien ne la restreint, comme avant les quatre cités.
    expect(cityTerroirAdmits(undefined, GROW_OLIVES)).toBe(true);
  });

  it('recette de départ d’une cité : la sienne, sinon la commune, y compris pour une cité inconnue', () => {
    const config = withOlives({ terroir: ['grow_olives'], startingRecipeId: 'grow_olives' });
    expect(cityStartingRecipeId(config, 'kalliste')).toBe('grow_olives');
    expect(cityStartingRecipeId(config, 'delos')).toBe('grow_wheat');
  });
});

describe('navires (4.6)', () => {
  const coaster = () => at(clone().ships.classes, 0);
  const withClass = (patch: Record<string, unknown>) => ({
    ...clone(),
    ships: { ...clone().ships, classes: [{ ...coaster(), ...patch }] },
  });

  it('une version publiée avant le transport reste lisible, sans aucune classe de navire', () => {
    const older: Partial<GameConfig> = clone();
    delete older.ships;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.ships).toEqual({
      classes: [],
      routes: [],
      portDues: { byClassOboles: {}, burnShareBps: 10_000, cityCoefficientBps: {} },
    });
    expect(Object.isFrozen(DEFAULT_SHIPS.classes)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SHIPS.portDues.byClassOboles)).toBe(true);
  });

  it('une classe : capacité, vitesse et prix entiers positifs bornés, entretien entier positif ou nul', () => {
    const field = (patch: Record<string, unknown>) =>
      errorsOf(withClass(patch)).map((error) => error.split(':')[0]);
    expect(field({ dailyUpkeepOboles: 0 })).toEqual([]);
    expect(field({ speedBps: 1_000, capacityUnits: 1_000_000, purchaseCostOboles: 1 })).toEqual([]);
    for (const [key, values] of [
      ['capacityUnits', [0, 1.5, 1_000_001]],
      ['speedBps', [999, 100_001, 10_000.5]],
      ['purchaseCostOboles', [0, -1, 2.5, 1_000_000_001]],
      ['dailyUpkeepOboles', [-1, 0.5]],
    ] as const)
      for (const value of values)
        expect([key, value, field({ [key]: value })]).toEqual([
          key,
          value,
          [`ships.classes[0].${key}`],
        ]);
    expect(field({ escort: true })).toEqual(['ships.classes[0]']);
    const withoutPrice: Partial<ReturnType<typeof coaster>> = coaster();
    delete withoutPrice.purchaseCostOboles;
    expect(
      errorsOf({ ...clone(), ships: { ...clone().ships, classes: [withoutPrice] } }).map(
        (e) => e.split(':')[0],
      ),
    ).toEqual(['ships.classes[0].purchaseCostOboles']);
  });

  it('identifiant sans doublon, section sans autre clé, au plus vingt classes', () => {
    expect(
      errorsOf({ ...clone(), ships: { ...clone().ships, classes: [coaster(), coaster()] } }),
    ).toEqual(['ships.classes: duplicate id "coaster"']);
    expect(
      errorsOf({ ...clone(), ships: { classes: [], escorts: [] } }).map((e) => e.split(':')[0]),
    ).toEqual(['ships']);
    const many = Array.from({ length: 21 }, (_, n) => ({ ...coaster(), id: `ship_${n}` }));
    expect(errorsOf({ ...clone(), ships: { classes: many } }).map((e) => e.split(':')[0])).toEqual([
      'ships.classes',
    ]);
  });
});

describe('citoyenneté et archonte (3, 6.2)', () => {
  const fieldsOf = (politics: unknown) =>
    errorsOf({ ...clone(), politics }).map((error) => error.split(':')[0]);
  const politics = () => structuredClone(FIXTURE.politics) as NonNullable<GameConfig['politics']>;

  it('une version publiée avant la citoyenneté reste lisible, sans section politique', () => {
    const older: Partial<GameConfig> = clone();
    delete older.politics;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.politics).toBeUndefined();
  });

  it('jours entiers d’au moins un jour et d’au plus une année, mandats consécutifs de 1 à 100', () => {
    expect(fieldsOf(politics())).toEqual([]);
    const tight = politics();
    tight.archon = { termDays: 2, candidacyDays: 1, votingDays: 1, maxConsecutiveTerms: 1 };
    tight.meticDays = 366;
    expect(fieldsOf(tight)).toEqual([]);
    expect(fieldsOf({ ...politics(), meticDays: 0 })).toEqual(['politics.meticDays']);
    expect(fieldsOf({ ...politics(), meticDays: 1.5 })).toEqual(['politics.meticDays']);
    for (const [key, values] of [
      ['termDays', [367, 30.5]],
      ['candidacyDays', [0, -1]],
      ['votingDays', [0, 1.5]],
      ['maxConsecutiveTerms', [0, 101]],
    ] as const)
      for (const value of values)
        expect([
          key,
          value,
          fieldsOf({ ...politics(), archon: { ...politics().archon, [key]: value } }),
        ]).toEqual([key, value, [`politics.archon.${key}`]]);
  });

  it('dépôt et vote tiennent dans un mandat : l’élection suivante s’ouvre pendant le mandat en cours', () => {
    const exact = politics();
    exact.archon = { ...exact.archon, termDays: 5, candidacyDays: 3, votingDays: 2 };
    expect(fieldsOf(exact)).toEqual([]);
    expect(fieldsOf({ ...exact, archon: { ...exact.archon, termDays: 4 } })).toEqual([
      'politics.archon.termDays',
    ]);
  });

  it('section et magistrature sans autre clé', () => {
    expect(fieldsOf({ ...politics(), council: {} })).toEqual(['politics']);
    expect(fieldsOf({ ...politics(), archon: { ...politics().archon, salary: 1 } })).toEqual([
      'politics.archon',
    ]);
    const missing: Record<string, unknown> = politics();
    delete missing['archon'];
    expect(fieldsOf(missing)).toEqual(['politics.archon']);
  });
});

describe('routes et droit de port (4.6, 5.6)', () => {
  /** Deux classes, trois cités à port et une sans port. */
  const archipelago = (ships: Record<string, unknown>): unknown => {
    const config = clone();
    const city = (id: string, hasPort = true) => ({ ...at(config.cities, 0), id, hasPort });
    const round = { ...at(config.ships.classes, 0), id: 'round_ship' };
    return {
      ...config,
      staff: { dailyWageOboles: {} },
      cities: [...config.cities, city('elaia'), city('halos'), city('oros', false)],
      ships: {
        ...config.ships,
        classes: [...config.ships.classes, round],
        portDues: dues({}),
        ...ships,
      },
    };
  };
  const route = (cities: [string, string], hours = 4, provisionsOboles = {}) => ({
    cities,
    hours,
    provisionsOboles,
  });
  const dues = (patch: Record<string, unknown>) => ({
    byClassOboles: {},
    burnShareBps: 5_000,
    cityCoefficientBps: {},
    ...patch,
  });

  it('une version publiée avec les navires mais avant les voyages se lit sans route ni droit de port', () => {
    const result = validateConfig({ ...clone(), ships: { classes: clone().ships.classes } });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.ships.routes).toEqual([]);
    expect(portDuesBaseOboles(result.config, 'coaster')).toBe(0);
    expect(cityPortDuesCoefficientBps(result.config, 'kalliste')).toBe(10_000);
  });

  it('une route relie deux cités à port, dans les deux sens, en 2 à 20 heures entières', () => {
    const valid = archipelago({
      routes: [route(['kalliste', 'elaia'], 2), route(['halos', 'kalliste'], 20)],
    });
    const result = validateConfig(valid);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(shipRoute(result.config, 'elaia', 'kalliste')?.hours).toBe(2);
    expect(shipRoute(result.config, 'kalliste', 'halos')?.hours).toBe(20);
    expect(shipRoute(result.config, 'elaia', 'halos')).toBeUndefined();
    for (const hours of [1, 21, 4.5])
      expect(
        errorsOf(archipelago({ routes: [route(['kalliste', 'elaia'], hours)] })).map(
          (e) => e.split(':')[0],
        ),
      ).toEqual(['ships.routes[0].hours']);
    expect(errorsOf(archipelago({ routes: [route(['kalliste', 'kalliste'])] }))).toEqual([
      'ships.routes[0].cities: a route links two different cities',
    ]);
    expect(errorsOf(archipelago({ routes: [route(['kalliste', 'delos'])] }))).toEqual([
      'ships.routes[0].cities[1]: unknown city "delos"',
    ]);
    expect(errorsOf(archipelago({ routes: [route(['oros', 'kalliste'])] }))).toEqual([
      'ships.routes[0].cities[0]: city "oros" has no port',
    ]);
    expect(
      errorsOf(
        archipelago({ routes: [route(['kalliste', 'elaia']), route(['elaia', 'kalliste'])] }),
      ),
    ).toEqual(['ships.routes: duplicate route "elaia kalliste"']);
  });

  it('provisions : aucune, ou un montant entier positif ou nul pour chaque classe connue', () => {
    const withProvisions = (provisionsOboles: Record<string, number>) =>
      errorsOf(archipelago({ routes: [route(['kalliste', 'elaia'], 4, provisionsOboles)] }));
    expect(withProvisions({})).toEqual([]);
    expect(withProvisions({ coaster: 0, round_ship: 12 })).toEqual([]);
    expect(withProvisions({ coaster: 3 })).toEqual([
      'ships.routes[0].provisionsOboles: missing ship class "round_ship"',
    ]);
    expect(withProvisions({ coaster: 3, round_ship: 4, trireme: 1 })).toEqual([
      'ships.routes[0].provisionsOboles: unknown ship class "trireme"',
    ]);
    // Une classe nommée comme une propriété héritée des objets n'est pas « déjà là ».
    expect(withProvisions({ coaster: 3, constructor: 4 })).toEqual([
      'ships.routes[0].provisionsOboles: unknown ship class "constructor"',
      'ships.routes[0].provisionsOboles: missing ship class "round_ship"',
    ]);
    for (const value of [-1, 0.5, 1_000_000_001])
      expect(withProvisions({ coaster: value, round_ship: 0 }).map((e) => e.split(':')[0])).toEqual(
        ['ships.routes[0].provisionsOboles.coaster'],
      );
    const result = validateConfig(
      archipelago({ routes: [route(['kalliste', 'elaia'], 4, { coaster: 7, round_ship: 9 })] }),
    );
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const kallisteElaia = shipRoute(result.config, 'kalliste', 'elaia');
    if (!kallisteElaia) throw new Error('route missing');
    expect(routeProvisionsOboles(kallisteElaia, 'round_ship')).toBe(9);
    expect(routeProvisionsOboles(kallisteElaia, 'trireme')).toBe(0);
  });

  it('pertes en mer (#730) : risque de la route et majoration de tempête, nuls si absents, de 0 à 10 000 points de base', () => {
    const withRisk = (risk: Record<string, unknown>) =>
      archipelago({ routes: [{ ...route(['kalliste', 'elaia']), ...risk }] });
    // Une version publiée avant les pertes n'a ni l'un ni l'autre : aucun voyage ne perd rien.
    const before = validateConfig(withRisk({}));
    if (!before.ok) throw new Error(before.errors.join('\n'));
    expect(shipRoute(before.config, 'elaia', 'kalliste')).toMatchObject({
      lossRiskBps: 0,
      stormLossRiskBps: 0,
    });
    const risky = validateConfig(withRisk({ lossRiskBps: 300, stormLossRiskBps: 10_000 }));
    if (!risky.ok) throw new Error(risky.errors.join('\n'));
    expect(shipRoute(risky.config, 'kalliste', 'elaia')).toMatchObject({
      lossRiskBps: 300,
      stormLossRiskBps: 10_000,
    });
    for (const key of ['lossRiskBps', 'stormLossRiskBps'])
      for (const bad of [-1, 10_001, 2.5, '300'])
        expect(errorsOf(withRisk({ [key]: bad })).map((e) => e.split(':')[0])).toEqual([
          `ships.routes[0].${key}`,
        ]);
  });

  it('droit de port : forfait de chaque classe connue, part détruite et coefficient bornés', () => {
    const withDues = (patch: Record<string, unknown>) =>
      errorsOf(archipelago({ portDues: dues(patch) }));
    expect(withDues({ byClassOboles: { coaster: 0, round_ship: 40 } })).toEqual([]);
    expect(withDues({ byClassOboles: { round_ship: 40 } })).toEqual([
      'ships.portDues.byClassOboles: missing ship class "coaster"',
    ]);
    expect(withDues({ cityCoefficientBps: { kalliste: 0, elaia: 100_000 } })).toEqual([]);
    expect(withDues({ cityCoefficientBps: { delos: 10_000 } })).toEqual([
      'ships.portDues.cityCoefficientBps.delos: unknown city "delos"',
    ]);
    expect(withDues({ cityCoefficientBps: { oros: 10_000 } })).toEqual([
      'ships.portDues.cityCoefficientBps.oros: city "oros" has no port',
    ]);
    for (const patch of [
      { burnShareBps: -1 },
      { burnShareBps: 10_001 },
      { cityCoefficientBps: { kalliste: 100_001 } },
      { cityCoefficientBps: { kalliste: 1.5 } },
      { byClassOboles: { coaster: -1, round_ship: 0 } },
    ])
      expect(withDues(patch)).toHaveLength(1);
    expect(withDues({ perArrival: true }).map((e) => e.split(':')[0])).toEqual(['ships.portDues']);
    const result = validateConfig(
      archipelago({
        portDues: dues({
          byClassOboles: { coaster: 40, round_ship: 90 },
          cityCoefficientBps: { elaia: 12_500 },
        }),
      }),
    );
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(portDuesBaseOboles(result.config, 'round_ship')).toBe(90);
    expect(cityPortDuesCoefficientBps(result.config, 'elaia')).toBe(12_500);
    // Cité sans coefficient : ×1.
    expect(cityPortDuesCoefficientBps(result.config, 'halos')).toBe(10_000);
    expect(cityPortDuesCoefficientBps(result.config, 'constructor')).toBe(10_000);
  });
});

describe('immobilier (4.5)', () => {
  const townhouse = () => at(clone().properties.sizes, 0);
  const withSize = (patch: Record<string, unknown>) => ({
    ...clone(),
    properties: { ...clone().properties, sizes: [{ ...townhouse(), ...patch }] },
  });
  const fields = (candidate: unknown) => errorsOf(candidate).map((error) => error.split(':')[0]);

  it('une version publiée avant l’immobilier reste lisible, sans aucun bien', () => {
    const older: Partial<GameConfig> = clone();
    delete older.properties;
    const result = validateConfig(older);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.config.properties).toEqual({ sizes: [], countsByCity: {} });
    expect(Object.isFrozen(DEFAULT_PROPERTIES.sizes)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PROPERTIES.countsByCity)).toBe(true);
  });

  it('une taille : prix, capacité et coût de rénovation positifs, entretien, vétusté et seuil bornés', () => {
    expect(
      fields(withSize({ dailyUpkeepOboles: 0, dailyWear: 0, minHabitableCondition: 0 })),
    ).toEqual([]);
    expect(fields(withSize({ dailyWear: 10_000, minHabitableCondition: 10_000 }))).toEqual([]);
    for (const [key, values] of [
      ['purchasePriceOboles', [0, -1, 2.5, 1_000_000_001]],
      ['housingUnits', [0, 1.5, 1_000_001]],
      ['dailyUpkeepOboles', [-1, 0.5]],
      ['dailyWear', [-1, 10_001, 0.5]],
      ['minHabitableCondition', [-1, 10_001, 0.5]],
    ] as const)
      for (const value of values)
        expect([key, value, fields(withSize({ [key]: value }))]).toEqual([
          key,
          value,
          [`properties.sizes[0].${key}`],
        ]);
    // Une rénovation gratuite n'aurait pas d'écriture du grand livre, à laquelle la base la reconnaît.
    expect(fields(withSize({ renovation: { oboles: 0, goods: [] } }))).toEqual([
      'properties.sizes[0].renovation.oboles',
    ]);
    expect(fields(withSize({ renovation: { oboles: 1, goods: [] } }))).toEqual([]);
    expect(fields(withSize({ shop: true }))).toEqual(['properties.sizes[0]']);
  });

  it('rénovation : des biens connus, chacun une fois, en quantité positive', () => {
    const goods = (list: unknown[]) =>
      errorsOf(withSize({ renovation: { oboles: 10, goods: list } }));
    expect(goods([{ goodId: 'marble', quantity: 1 }])).toEqual([
      'properties.sizes[0].renovation.goods[0].goodId: unknown good "marble"',
    ]);
    expect(
      goods([
        { goodId: 'wheat', quantity: 1 },
        { goodId: 'wheat', quantity: 2 },
      ]),
    ).toEqual(['properties.sizes[0].renovation.goods: duplicate good "wheat"']);
    expect(goods([{ goodId: 'wheat', quantity: 0 }]).map((e) => e.split(':')[0])).toEqual([
      'properties.sizes[0].renovation.goods[0].quantity',
    ]);
  });

  it('parc : des cités et des tailles connues, des nombres entiers bornés, des tailles uniques', () => {
    const counts = (countsByCity: unknown) =>
      errorsOf({ ...clone(), properties: { ...clone().properties, countsByCity } });
    expect(counts({ atlantis: { townhouse: 1 } })).toEqual([
      'properties.countsByCity.atlantis: unknown city "atlantis"',
    ]);
    expect(counts({ kalliste: { palace: 1 } })).toEqual([
      'properties.countsByCity.kalliste.palace: unknown size "palace"',
    ]);
    for (const value of [-1, 10_001, 1.5])
      expect(counts({ kalliste: { townhouse: value } }).map((e) => e.split(':')[0])).toEqual([
        'properties.countsByCity.kalliste.townhouse',
      ]);
    expect(counts({ kalliste: { townhouse: 0 } })).toEqual([]);
    expect(
      errorsOf({ ...clone(), properties: { sizes: [townhouse(), townhouse()], countsByCity: {} } }),
    ).toEqual(['properties.sizes: duplicate id "townhouse"']);
  });
});
