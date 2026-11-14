import { DEFAULT_SITES } from '@oikos/config/schema';
import { z } from 'zod';

const name = z.string().min(1);
const positiveInt = z.number().int().positive();
const stack = z.object({ goodId: name, quantity: positiveInt });
/**
 * Ce que le client lit des règles des sites (vue `public.site_rules`). Schéma souple sur la forme : une
 * configuration plus récente que le client (champ ou type de site nouveau) reste lisible. L'API fait
 * foi ; le client ne s'en sert que pour proposer des choix et annoncer des prix. Les valeurs, elles, sont
 * tenues : un prix, une durée ou une limite qui ne sont pas des entiers positifs font échouer la lecture.
 */
const siteRulesSchema = z.object({
  recipes: z.array(
    z.object({
      id: name,
      siteType: name,
      inputs: z.array(stack),
      outputs: z.array(stack).min(1),
      durationMinutes: positiveInt,
    }),
  ),
  // Version publiée avant la section : valeurs par défaut du schéma partagé, comme pour l'API.
  sites: z
    .object({
      limitByHeadquartersLevel: z.array(positiveInt).min(1),
      acquisitionCostOboles: z.record(name, positiveInt),
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
  // `Map` : un type de site nommé comme une propriété d'objet (« constructor ») n'a pas de prix.
  const costs = new Map(Object.entries(sites.acquisitionCostOboles));
  // Les ateliers (recettes à intrants) ne s'acquièrent pas encore : l'API les refuse.
  const available = recipes.filter((recipe) => recipe.inputs.length === 0);
  const typeOf = (recipeId: string) =>
    recipes.find((recipe) => recipe.id === recipeId)?.siteType ?? null;
  return {
    limit: sites.limitByHeadquartersLevel[0] ?? 0,
    offers: available.flatMap((recipe) => {
      const costOboles = costs.get(recipe.siteType);
      return costOboles === undefined ? [] : [{ recipe, costOboles }];
    }),
    siteTypeOf: typeOf,
    alternatives: (recipeId) => {
      const type = typeOf(recipeId);
      return available.filter((recipe) => recipe.siteType === type && recipe.id !== recipeId);
    },
  };
}
