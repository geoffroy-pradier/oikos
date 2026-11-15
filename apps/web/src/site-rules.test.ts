import { DEFAULT_SITES, gameConfigSchema } from '@oikos/config/schema';
import { INITIAL_CONFIG } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import { freeStockIn, parseSiteRules, previewHarvest, siteAlerts, stockByCity } from './site-rules';

const config = gameConfigSchema.parse(INITIAL_CONFIG);
const raw = (overrides: Record<string, unknown> = {}) => ({
  recipes: config.recipes,
  sites: config.sites,
  ...overrides,
});

describe('parseSiteRules', () => {
  it('propose chaque recette, ateliers compris, au prix de son type de site', () => {
    const rules = parseSiteRules(raw());
    const offers = Object.fromEntries(
      rules?.offers.map((offer) => [offer.recipe.id, offer.costOboles]) ?? [],
    );
    expect(config.recipes.some((recipe) => recipe.inputs.length > 0)).toBe(true);
    expect(offers).toEqual(
      Object.fromEntries(
        config.recipes.map((recipe) => [
          recipe.id,
          config.sites.acquisitionCostOboles[recipe.siteType],
        ]),
      ),
    );
    expect(rules?.limit).toBe(config.sites.limitByHeadquartersLevel[0]);
    // Toute maison est au premier niveau de siège : c'est sa limite qui vaut.
    const tiers = parseSiteRules(
      raw({ sites: { ...config.sites, limitByHeadquartersLevel: [2, 5] } }),
    );
    expect(tiers?.limit).toBe(2);
  });

  it('ne propose à un site que les autres recettes de son type', () => {
    const rules = parseSiteRules(raw());
    expect(rules?.alternatives('grow_olives').map((recipe) => recipe.id)).toEqual(['grow_grapes']);
    expect(rules?.alternatives('grow_wheat')).toEqual([]);
    // Un atelier passe d'une recette d'atelier à une autre, jamais à une culture.
    const workshops = config.recipes
      .filter((recipe) => recipe.siteType === 'workshop' && recipe.id !== 'mill_flour')
      .map((recipe) => recipe.id);
    expect(rules?.alternatives('mill_flour').map((recipe) => recipe.id)).toEqual(workshops);
    expect(rules?.recipe('mill_flour')?.inputs).toEqual([{ goodId: 'wheat', quantity: 10 }]);
    expect(rules?.siteTypeOf('rake_salt')).toBe('fishery');
    expect(rules?.siteTypeOf('mill_flour')).toBe('workshop');
  });

  it('recette retirée de la configuration : pas de type, toutes les recettes sont proposées (4.2)', () => {
    const rules = parseSiteRules(raw());
    expect(rules?.recipe('inconnue')).toBeNull();
    expect(rules?.siteTypeOf('inconnue')).toBeNull();
    expect(rules?.upkeepOf('inconnue')).toBe(0);
    expect(rules?.alternatives('inconnue').map((recipe) => recipe.id)).toEqual(
      config.recipes.map((recipe) => recipe.id),
    );
  });

  it('applique les valeurs par défaut du schéma partagé à une version sans section des sites', () => {
    const rules = parseSiteRules(raw({ sites: null }));
    expect(rules?.limit).toBe(DEFAULT_SITES.limitByHeadquartersLevel[0]);
    expect(rules?.offers.find((offer) => offer.recipe.id === 'dig_clay')?.costOboles).toBe(
      DEFAULT_SITES.acquisitionCostOboles.quarry,
    );
  });

  it('reste lisible quand la configuration est plus récente que le client', () => {
    const rules = parseSiteRules(
      raw({
        recipes: [
          { ...config.recipes[0], id: 'tend_bees', siteType: 'apiary', futureField: true },
          ...config.recipes,
        ],
        sites: {
          ...config.sites,
          acquisitionCostOboles: { ...config.sites.acquisitionCostOboles, apiary: 450 },
          futureField: 1,
        },
      }),
    );
    expect(rules?.offers[0]).toMatchObject({ recipe: { id: 'tend_bees' }, costOboles: 450 });
  });

  it('écarte une recette dont le type de site n’a pas de prix, et refuse une réponse malformée', () => {
    const rules = parseSiteRules(
      raw({ sites: { ...config.sites, acquisitionCostOboles: { field: 600 } } }),
    );
    expect(rules?.offers.map((offer) => offer.recipe.id)).toEqual(['grow_wheat']);
    const first = config.recipes[0];
    const broken = [
      null,
      {},
      raw({ recipes: 'x' }),
      raw({ sites: undefined }),
      raw({ sites: { ...config.sites, limitByHeadquartersLevel: [] } }),
      raw({ sites: { ...config.sites, limitByHeadquartersLevel: [0] } }),
      raw({ sites: { ...config.sites, acquisitionCostOboles: { field: -5 } } }),
      raw({ sites: { ...config.sites, acquisitionCostOboles: { field: 1.5 } } }),
      raw({ recipes: [{ ...first, id: '' }] }),
      raw({ recipes: [{ ...first, durationMinutes: 0 }] }),
      raw({ recipes: [{ ...first, outputs: [] }] }),
    ];
    for (const value of broken) expect(parseSiteRules(value)).toBeNull();
  });

  it('un type de site nommé comme une propriété d’objet n’a pas de prix', () => {
    const first = config.recipes[0];
    const rules = parseSiteRules(
      raw({ recipes: [{ ...first, id: 'odd', siteType: 'constructor' }, first] }),
    );
    expect(rules?.offers.map((offer) => offer.recipe.id)).toEqual([first?.id]);
  });
});

describe('entretien d’un site', () => {
  it('annonce l’entretien d’un jour du type du site, coefficient compris, arrondi à l’obole supérieure', () => {
    const upkeep = { coefficientBps: 12_500, dailyOboles: { field: 30, quarry: 60, workshop: 45 } };
    const rules = parseSiteRules(raw({ sites: { ...config.sites, upkeep } }));
    // 30 × 1,25 = 37,5 → 38 ; 60 × 1,25 = 75 ; 45 × 1,25 = 56,25 → 57.
    expect(rules?.upkeepOf('grow_wheat')).toBe(38);
    expect(rules?.upkeepOf('dig_clay')).toBe(75);
    expect(rules?.upkeepOf('mill_flour')).toBe(57);
    // Type sans tarif dans cette version, recette inconnue : rien n'est dû.
    expect(rules?.upkeepOf('grow_olives')).toBe(0);
    expect(rules?.upkeepOf('inconnue')).toBe(0);
    expect(parseSiteRules(raw())?.upkeepOf('grow_wheat')).toBe(30);
  });

  it('version publiée avant l’entretien, ou sans section des sites : rien n’est dû ; montant invalide : lecture refusée', () => {
    const { limitByHeadquartersLevel, acquisitionCostOboles } = config.sites;
    const before = { limitByHeadquartersLevel, acquisitionCostOboles };
    expect(parseSiteRules(raw({ sites: before }))?.upkeepOf('grow_wheat')).toBe(0);
    expect(parseSiteRules(raw({ sites: null }))?.upkeepOf('dig_clay')).toBe(0);
    const bad = { coefficientBps: 10_000, dailyOboles: { field: -1 } };
    expect(parseSiteRules(raw({ sites: { ...config.sites, upkeep: bad } }))).toBeNull();
  });

  it('bornes du serveur : ×10 et un milliard d’oboles au plus ; au-delà, lecture refusée', () => {
    const upkeepOf = (upkeep: { coefficientBps: number; dailyOboles: Record<string, number> }) =>
      parseSiteRules(raw({ sites: { ...config.sites, upkeep } }))?.upkeepOf('grow_wheat') ?? null;
    expect(upkeepOf({ coefficientBps: 100_000, dailyOboles: { field: 1_000_000_000 } })).toBe(
      10_000_000_000,
    );
    expect(upkeepOf({ coefficientBps: 100_001, dailyOboles: { field: 30 } })).toBeNull();
    expect(upkeepOf({ coefficientBps: 10_000, dailyOboles: { field: 1_000_000_001 } })).toBeNull();
    expect(upkeepOf({ coefficientBps: 10_000, dailyOboles: { field: 1.5 } })).toBeNull();
  });
});

describe('previewHarvest', () => {
  const rules = parseSiteRules(raw());
  const mill = rules?.recipe('mill_flour');
  const field = rules?.recipe('grow_wheat');
  if (!mill || !field) throw new Error('recipes missing from the initial configuration');
  const since = new Date('2026-01-01T00:00:00Z');
  const after = (minutes: number) => new Date(since.getTime() + minutes * 60_000);

  it('une production primaire : les cycles écoulés, sans intrant', () => {
    expect(previewHarvest(field, since, after(2.5 * field.durationMinutes), () => 0)).toEqual({
      cycles: 2,
      waiting: 0,
      inputs: [],
      outputs: [{ goodId: 'wheat', quantity: 80 }],
    });
    expect(previewHarvest(field, since, after(10), () => 0).cycles).toBe(0);
  });

  it('site à l’arrêt : le temps s’arrête à l’arrêt ; un atelier à l’arrêt n’annonce rien', () => {
    // Champ de 3,5 cycles dont les 1,25 derniers à l'arrêt : 2 cycles (80 blé), pas 3.
    const [now, halted] = [after(3.5 * field.durationMinutes), after(2.25 * field.durationMinutes)];
    expect(previewHarvest(field, since, now, () => 0, halted)).toMatchObject({
      cycles: 2,
      outputs: [{ goodId: 'wheat', quantity: 80 }],
    });
    expect(previewHarvest(field, since, now, () => 0, null).cycles).toBe(3);
    // Arrêt postérieur à l'heure lue (horloge du navigateur en retard) : compté jusqu'à cette heure.
    expect(
      previewHarvest(field, since, now, () => 0, after(9 * field.durationMinutes)).cycles,
    ).toBe(3);
    // Moulin de trois cycles, du blé pour tous : à l'arrêt, ni récolte ni attente d'intrants annoncées.
    const stocked = () => 1_000;
    const milling = after(3 * mill.durationMinutes);
    expect(previewHarvest(mill, since, milling, stocked, after(mill.durationMinutes))).toEqual({
      cycles: 0,
      waiting: 0,
      inputs: [],
      outputs: [],
    });
    expect(previewHarvest(mill, since, milling, stocked).cycles).toBe(3);
  });

  it('un atelier : borné par le stock libre, le reste attend', () => {
    // Trois cycles écoulés, du blé pour deux.
    const stock = (goodId: string) => (goodId === 'wheat' ? 25 : 0);
    expect(previewHarvest(mill, since, after(3 * mill.durationMinutes), stock)).toEqual({
      cycles: 2,
      waiting: 1,
      inputs: [{ goodId: 'wheat', quantity: 20 }],
      outputs: [{ goodId: 'flour', quantity: 16 }],
    });
    expect(previewHarvest(mill, since, after(3 * mill.durationMinutes), () => 0)).toMatchObject({
      cycles: 0,
      waiting: 3,
    });
  });

  it('ne dépasse pas le plafond d’accumulation du site', () => {
    const long = after(100 * 60);
    expect(mill.maxAccruedCycles).toBeLessThan(100);
    expect(previewHarvest(mill, since, long, () => 100_000).cycles).toBe(mill.maxAccruedCycles);
    expect(previewHarvest(mill, since, long, () => 0)).toMatchObject({
      cycles: 0,
      waiting: mill.maxAccruedCycles,
    });
  });

  it('un stock libre négatif ou fractionnaire lu par erreur ne fait rien tourner de trop', () => {
    expect(previewHarvest(mill, since, after(600), () => -5).cycles).toBe(0);
    expect(previewHarvest(mill, since, after(600), () => 19.9).cycles).toBe(1);
  });
});

describe('freeStockIn', () => {
  const stock = [
    { city_id: 'ailleurs', good_id: 'wheat', quantity: 500, reserved: 0 },
    { city_id: 'ici', good_id: 'wheat', quantity: 80, reserved: 75 },
    { city_id: 'ici', good_id: 'flour', quantity: 12, reserved: 0 },
  ];

  it('retire ce que des ventes ont réservé', () => {
    expect(freeStockIn(stock, 'ici', 'wheat')).toBe(5);
    expect(freeStockIn(stock, 'ici', 'flour')).toBe(12);
  });

  it('ne compte que le stock de la cité du site, et zéro pour un bien absent', () => {
    expect(freeStockIn(stock, 'ailleurs', 'wheat')).toBe(500);
    expect(freeStockIn(stock, 'ailleurs', 'flour')).toBe(0);
    expect(freeStockIn(stock, 'ici', 'charcoal')).toBe(0);
    expect(freeStockIn([], 'ici', 'wheat')).toBe(0);
  });
});

describe('siteAlerts', () => {
  const rules = parseSiteRules(raw());
  const mill = rules?.recipe('mill_flour');
  const field = rules?.recipe('grow_wheat');
  if (!mill || !field) throw new Error('recettes de départ introuvables');
  const since = new Date('2026-11-14T00:00:00Z');
  const after = (minutes: number) => new Date(since.getTime() + minutes * 60_000);
  const at = (recipe: typeof mill, cycles: number, stock: number) =>
    previewHarvest(recipe, since, after(cycles * recipe.durationMinutes), () => stock);

  it('rien à signaler tant que le site produit sous son plafond', () => {
    expect(siteAlerts(field, at(field, 1, 0), false)).toEqual([]);
    expect(siteAlerts(mill, at(mill, 1, 1_000), false)).toEqual([]);
  });

  it('atelier à court : des cycles écoulés attendent des intrants', () => {
    expect(siteAlerts(mill, at(mill, 1, 0), false)).toEqual(['short']);
  });

  it('au plafond : exactement au plafond, et au-delà', () => {
    const cap = field.maxAccruedCycles;
    expect(siteAlerts(field, at(field, cap - 1, 0), false)).toEqual([]);
    expect(siteAlerts(field, at(field, cap, 0), false)).toEqual(['full']);
    expect(siteAlerts(field, at(field, cap + 5, 0), false)).toEqual(['full']);
  });

  it('atelier au plafond avec assez d’intrants : seulement au plafond', () => {
    expect(siteAlerts(mill, at(mill, mill.maxAccruedCycles, 1_000_000), false)).toEqual(['full']);
  });

  it('atelier au plafond et à court : les deux alertes, à court d’abord', () => {
    expect(siteAlerts(mill, at(mill, mill.maxAccruedCycles, 0), false)).toEqual(['short', 'full']);
  });

  it('site à l’arrêt : seule l’alerte d’arrêt, même au plafond', () => {
    expect(siteAlerts(field, at(field, field.maxAccruedCycles, 0), true)).toEqual(['halted']);
  });
});

describe('stockByCity', () => {
  const line = (id: string, city_id: string) => ({ id, city_id });

  it('met la cité de la maison d’abord, garde l’ordre des lignes dans chaque cité', () => {
    const lines = [
      line('a', 'loin'),
      line('b', 'ici'),
      line('c', 'autre'),
      line('d', 'loin'),
      line('e', 'ici'),
    ];
    expect(stockByCity(lines, 'ici')).toEqual([
      { cityId: 'ici', lines: [line('b', 'ici'), line('e', 'ici')] },
      { cityId: 'loin', lines: [line('a', 'loin'), line('d', 'loin')] },
      { cityId: 'autre', lines: [line('c', 'autre')] },
    ]);
  });

  it('sans stock dans la cité de la maison, elle n’apparaît pas ; sans stock, rien', () => {
    expect(stockByCity([line('a', 'loin')], 'ici')).toEqual([
      { cityId: 'loin', lines: [line('a', 'loin')] },
    ]);
    expect(stockByCity([], 'ici')).toEqual([]);
  });
});
