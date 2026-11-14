import { DEFAULT_SITES, DEFAULT_UPKEEP } from '@oikos/config/schema';
import { accrueWorkshop, dailyUpkeep } from '@oikos/sim';
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
      maxAccruedCycles: positiveInt,
    }),
  ),
  // Version publiée avant la section : valeurs par défaut du schéma partagé, comme pour l'API.
  sites: z
    .object({
      limitByHeadquartersLevel: z.array(positiveInt).min(1),
      acquisitionCostOboles: z.record(name, positiveInt),
      // Version publiée avant l'entretien : rien n'est dû, comme pour l'API.
      upkeep: z
        .object({
          coefficientBps: z.number().int().nonnegative(),
          dailyOboles: z.record(name, z.number().int().nonnegative()),
        })
        .default(DEFAULT_UPKEEP),
    })
    .nullable()
    .transform((sites) => sites ?? DEFAULT_SITES),
});
type RawRules = z.infer<typeof siteRulesSchema>;
export type SiteRecipe = RawRules['recipes'][number];

export interface SiteRules {
  /** Nombre de sites qu'une maison peut exploiter (premier niveau de siège, le seul pour l'instant). */
  limit: number;
  /** Recettes qu'un site peut recevoir, avec le prix d'un site de leur type. */
  offers: { recipe: SiteRecipe; costOboles: number }[];
  /** Type de site d'une recette, connue ou non du client. */
  siteTypeOf(recipeId: string): string | null;
  /** Autres recettes qu'un site peut adopter : celles de son type. */
  alternatives(recipeId: string): SiteRecipe[];
  /** Recette d'un site, si la configuration en vigueur la connaît. */
  recipe(recipeId: string): SiteRecipe | null;
  /**
   * Entretien d'un jour du site qui exploite cette recette, en oboles (5.5) : ce que demande chaque
   * clôture, et ce que coûte une relance. Nul pour une recette inconnue, qui n'a pas de tarif.
   */
  upkeepOf(recipeId: string): number;
}

/** Rend `null` si la réponse n'a pas la forme attendue : l'écran annonce alors un échec de lecture. */
export function parseSiteRules(raw: unknown): SiteRules | null {
  const parsed = siteRulesSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { recipes, sites } = parsed.data;
  // `Map` : un type de site nommé comme une propriété d'objet (« constructor ») n'a pas de prix.
  const costs = new Map(Object.entries(sites.acquisitionCostOboles));
  const typeOf = (recipeId: string) =>
    recipes.find((recipe) => recipe.id === recipeId)?.siteType ?? null;
  return {
    limit: sites.limitByHeadquartersLevel[0] ?? 0,
    offers: recipes.flatMap((recipe) => {
      const costOboles = costs.get(recipe.siteType);
      return costOboles === undefined ? [] : [{ recipe, costOboles }];
    }),
    siteTypeOf: typeOf,
    alternatives: (recipeId) => {
      const type = typeOf(recipeId);
      return recipes.filter((recipe) => recipe.siteType === type && recipe.id !== recipeId);
    },
    recipe: (recipeId) => recipes.find((recipe) => recipe.id === recipeId) ?? null,
    upkeepOf: (recipeId) => {
      const base = new Map(Object.entries(sites.upkeep.dailyOboles)).get(typeOf(recipeId) ?? '');
      return base === undefined ? 0 : dailyUpkeep(base, sites.upkeep.coefficientBps);
    },
  };
}

export interface Harvest {
  /** Cycles qu'une récolte ferait tourner maintenant. */
  cycles: number;
  /** Cycles écoulés qui attendent des intrants. */
  waiting: number;
  inputs: { goodId: string; quantity: number }[];
  outputs: { goodId: string; quantity: number }[];
}

/**
 * Ce qu'une récolte donnerait maintenant, calculé comme le fait l'API (`accrueWorkshop`), à partir du
 * stock libre affiché. Indicatif : l'API recalcule tout à la récolte, avec son heure et son stock.
 */
export function previewHarvest(
  recipe: SiteRecipe,
  cycleStartedAt: Date,
  now: Date,
  freeStock: (goodId: string) => number,
  /** Instant de l'arrêt d'un site impayé (5.5), `null` s'il tourne. */
  haltedAt: Date | null = null,
): Harvest {
  // Un atelier à l'arrêt ne consomme aucun intrant : rien à récolter, rien en attente d'intrants.
  if (haltedAt && recipe.inputs.length > 0)
    return { cycles: 0, waiting: 0, inputs: [], outputs: [] };
  // Pour un site à l'arrêt, le temps s'est arrêté à l'instant de l'arrêt.
  const until = haltedAt && haltedAt < now ? haltedAt : now;
  const { cycles, elapsedCycles } = accrueWorkshop({
    since: cycleStartedAt,
    now: until,
    cycleMinutes: recipe.durationMinutes,
    maxCycles: recipe.maxAccruedCycles,
    inputs: recipe.inputs.map((stack) => ({
      perCycle: stack.quantity,
      available: Math.max(0, Math.floor(freeStock(stack.goodId))),
    })),
  });
  const scaled = (stacks: SiteRecipe['inputs']) =>
    stacks.map((stack) => ({ goodId: stack.goodId, quantity: cycles * stack.quantity }));
  return {
    cycles,
    waiting: elapsedCycles - cycles,
    inputs: scaled(recipe.inputs),
    outputs: scaled(recipe.outputs),
  };
}

export interface StockLine {
  city_id: string;
  good_id: string;
  quantity: number;
  reserved: number;
}

/**
 * Stock libre d'un bien dans une cité : ce que des ventes en attente ont réservé n'est pas consommé
 * par un atelier, et un site ne puise que dans le stock de sa propre cité.
 */
export function freeStockIn(stock: readonly StockLine[], cityId: string, goodId: string): number {
  const line = stock.find(
    (candidate) => candidate.city_id === cityId && candidate.good_id === goodId,
  );
  return line ? line.quantity - line.reserved : 0;
}
