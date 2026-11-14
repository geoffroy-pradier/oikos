import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKET_TAX,
  DEFAULT_PRICE_HISTORY,
  DEFAULT_SITES,
  validateConfig,
  type GameConfig,
} from './index';

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
  market: { npcMaxPriceFactor: 3 },
  marketTax: { rateBps: 400, burnShareBps: 2500 },
  priceHistory: { candleMinutes: 15, referenceWindowHours: 48 },
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
    });
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
