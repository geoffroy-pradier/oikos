import { DEFAULT_SITES } from '@oikos/config/schema';
import { z } from 'zod';

const stack = z.object({ goodId: z.string(), quantity: z.number() });
/**
 * Ce que le client lit des règles des sites (`public.site_rules()`). Schéma volontairement souple : une
 * configuration plus récente que le client (champ ou type de site nouveau) reste lisible. L'API fait
 * foi ; le client ne s'en sert que pour proposer des choix et annoncer des prix.
 */
const siteRulesSchema = z.object({
  recipes: z.array(
    z.object({
      id: z.string(),
      siteType: z.string(),
      inputs: z.array(stack),
      outputs: z.array(stack),
      durationMinutes: z.number(),
    }),
  ),
  // Version publiée avant la section : valeurs par défaut du schéma partagé, comme pour l'API.
  sites: z
    .object({
      limitByHeadquartersLevel: z.array(z.number()).min(1),
      acquisitionCostOboles: z.record(z.string(), z.number()),
    })
    .nullable()
    .transform((sites) => sites ?? DEFAULT_SITES),
});
type RawRules = z.infer<typeof siteRulesSchema>;
export type SiteRecipe = RawRules['recipes'][number];

export interface SiteRules {
  /** Nombre de sites qu'une maison peut exploiter (premier niveau de siège, le seul pour l'instant). */
  limit: number;
  /** Recettes qu'un site peut recevoir aujourd'hui, avec le prix d'un site de leur type. */
  offers: { recipe: SiteRecipe; costOboles: number }[];
  /** Type de site d'une recette, connue ou non du client. */
  siteTypeOf(recipeId: string): string | null;
  /** Autres recettes qu'un site peut adopter : celles de son type. */
  alternatives(recipeId: string): SiteRecipe[];
}

/** Rend `null` si la réponse n'a pas la forme attendue : l'écran annonce alors un échec de lecture. */
export function parseSiteRules(raw: unknown): SiteRules | null {
  const parsed = siteRulesSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { recipes, sites } = parsed.data;
  const costs: Record<string, number | undefined> = sites.acquisitionCostOboles;
  // Les ateliers (recettes à intrants) ne s'acquièrent pas encore : l'API les refuse.
  const available = recipes.filter((recipe) => recipe.inputs.length === 0);
  const typeOf = (recipeId: string) =>
    recipes.find((recipe) => recipe.id === recipeId)?.siteType ?? null;
  return {
    limit: sites.limitByHeadquartersLevel[0] ?? 0,
    offers: available.flatMap((recipe) => {
      const costOboles = costs[recipe.siteType];
      return costOboles === undefined ? [] : [{ recipe, costOboles }];
    }),
    siteTypeOf: typeOf,
    alternatives: (recipeId) => {
      const type = typeOf(recipeId);
      return available.filter((recipe) => recipe.siteType === type && recipe.id !== recipeId);
    },
  };
}
