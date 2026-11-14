import { DEFAULT_SITES, gameConfigSchema } from '@oikos/config/schema';
import { INITIAL_CONFIG } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import { parseSiteRules } from './site-rules';

const config = gameConfigSchema.parse(INITIAL_CONFIG);
const raw = (overrides: Record<string, unknown> = {}) => ({
  configVersionId: '01900000-0000-7000-8000-00000000c001',
  recipes: config.recipes,
  sites: config.sites,
  ...overrides,
});

describe('parseSiteRules', () => {
  it('propose les productions primaires au prix de leur type de site, jamais les ateliers', () => {
    const rules = parseSiteRules(raw());
    const offers = Object.fromEntries(
      rules?.offers.map((offer) => [offer.recipe.id, offer.costOboles]) ?? [],
    );
    const primary = config.recipes.filter((recipe) => recipe.inputs.length === 0);
    expect(primary.length).toBeLessThan(config.recipes.length);
    expect(offers).toEqual(
      Object.fromEntries(
        primary.map((recipe) => [recipe.id, config.sites.acquisitionCostOboles[recipe.siteType]]),
      ),
    );
    expect(rules?.limit).toBe(config.sites.limitByHeadquartersLevel[0]);
  });

  it('ne propose à un site que les autres recettes de son type', () => {
    const rules = parseSiteRules(raw());
    expect(rules?.alternatives('grow_olives').map((recipe) => recipe.id)).toEqual(['grow_grapes']);
    expect(rules?.alternatives('grow_wheat')).toEqual([]);
    // Un atelier n'a pas d'alternative tant que ses recettes ne sont pas disponibles.
    expect(rules?.alternatives('mill_flour')).toEqual([]);
    expect(rules?.alternatives('inconnue')).toEqual([]);
    expect(rules?.siteTypeOf('rake_salt')).toBe('fishery');
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
    for (const broken of [
      null,
      {},
      raw({ recipes: 'x' }),
      raw({ sites: { limitByHeadquartersLevel: [] } }),
    ])
      expect(parseSiteRules(broken)).toBeNull();
  });
});
