import { DEFAULT_SITES, gameConfigSchema } from '@oikos/config/schema';
import { INITIAL_CONFIG } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import { parseSiteRules, previewHarvest } from './site-rules';

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
    expect(rules?.recipe('inconnue')).toBeNull();
    expect(rules?.alternatives('inconnue')).toEqual([]);
    expect(rules?.siteTypeOf('rake_salt')).toBe('fishery');
    expect(rules?.siteTypeOf('mill_flour')).toBe('workshop');
    expect(rules?.siteTypeOf('inconnue')).toBeNull();
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

  it('un stock libre négatif ou fractionnaire lu par erreur ne fait rien tourner de trop', () => {
    expect(previewHarvest(mill, since, after(600), () => -5).cycles).toBe(0);
    expect(previewHarvest(mill, since, after(600), () => 19.9).cycles).toBe(1);
  });
});
