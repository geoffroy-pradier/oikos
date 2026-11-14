import { DEFAULT_SITES, gameConfigSchema } from '@oikos/config/schema';
import { INITIAL_CONFIG } from '@oikos/config';
import { describe, expect, it } from 'vitest';
import { parseSiteRules } from './site-rules';

const config = gameConfigSchema.parse(INITIAL_CONFIG);
const raw = (overrides: Record<string, unknown> = {}) => ({
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
    // Un atelier n'a pas d'alternative tant que ses recettes ne sont pas disponibles.
    expect(rules?.alternatives('mill_flour')).toEqual([]);
    expect(rules?.alternatives('inconnue')).toEqual([]);
    expect(rules?.siteTypeOf('rake_salt')).toBe('fishery');
    // Le type d'un atelier déjà possédé reste connu, même si sa recette ne s'acquiert pas encore.
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
