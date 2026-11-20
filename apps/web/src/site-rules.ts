import {
  DEFAULT_SITES,
  DEFAULT_STEWARD_REFUSAL_REST_TICKS,
  DEFAULT_UPKEEP,
  staffDailyWageObolesSchema,
  upkeepCoefficientBpsSchema,
  upkeepDailyObolesSchema,
} from '@oikos/config/schema';
import { accrueWorkshop, dailyUpkeep, dailyWages } from '@oikos/sim';
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
      /** Travailleurs du site, payés chaque jour (4.4). Toute version publiée les porte. */
      workers: z.number().int().nonnegative().default(0),
    }),
  ),
  // Version publiée avant la section : valeurs par défaut du schéma partagé, comme pour l'API.
  sites: z
    .object({
      limitByHeadquartersLevel: z.array(positiveInt).min(1),
      acquisitionCostOboles: z.record(name, positiveInt),
      // Version publiée avant l'entretien : rien n'est dû, comme pour l'API. Montants bornés comme le
      // serveur les borne : un entretien hors de ces bornes ne peut pas être en vigueur.
      upkeep: z
        .object({
          coefficientBps: upkeepCoefficientBpsSchema,
          dailyOboles: z.record(name, upkeepDailyObolesSchema),
        })
        .default(DEFAULT_UPKEEP),
      // Salaire du jour par cité (section `staff` de la configuration, rendue ici par la vue) ; absent
      // d'une version publiée avant le personnel : aucun salaire, comme pour l'API.
      staff: z.object({ dailyWageOboles: z.record(name, staffDailyWageObolesSchema) }).optional(),
      // Intendants (section `stewards`, rendue ici sans ses noms, #278) ; absente d'une version publiée avant
      // eux : aucun poste, comme pour l'API.
      stewards: z
        .object({
          limitByHeadquartersLevel: z.array(z.number().int().nonnegative()).min(1),
          dailyWageOboles: staffDailyWageObolesSchema,
          rulesPerSteward: z.number().int().nonnegative(),
          // Repos d'une règle refusée (#621) ; absent d'une version publiée avant lui : aucun, comme pour le moteur.
          refusalRestTicks: z
            .number()
            .int()
            .nonnegative()
            .default(DEFAULT_STEWARD_REFUSAL_REST_TICKS),
        })
        .optional(),
      // Durée du tick (`clock.tickMinutes`, #640), pour dater un tick ; absente ou illisible : aucune heure n'est
      // annoncée, et le reste des règles reste lisible.
      clock: z.object({ tickMinutes: positiveInt }).optional().catch(undefined),
    })
    .nullable()
    .transform((sites) => sites ?? DEFAULT_SITES),
});
type RawRules = z.infer<typeof siteRulesSchema>;
export type SiteRecipe = RawRules['recipes'][number];

export interface SiteRules {
  /** Nombre de sites qu'une maison peut exploiter (premier niveau de siège, le seul pour l'instant). */
  limit: number;
  /**
   * Intendants (#278) : postes du premier niveau de siège, salaire d'un jour, règles au plus, repos d'une règle refusée
   * en ticks (#621) ; zéro sans eux.
   */
  stewards: StewardRules;
  /** Durée du tick en minutes (#640), `null` si la configuration lue ne la donne pas. */
  tickMinutes: number | null;
  /** Recettes qu'un site peut recevoir, avec le prix d'un site de leur type. */
  offers: { recipe: SiteRecipe; costOboles: number }[];
  /** Type de site d'une recette, connue ou non du client. */
  siteTypeOf(recipeId: string): string | null;
  /**
   * Autres recettes qu'un site peut adopter : celles de son type. Une recette que la configuration ne
   * connaît plus (recette retirée, 4.2) n'a pas de type : toutes les recettes sont alors proposées.
   */
  alternatives(recipeId: string): SiteRecipe[];
  /** Recette d'un site, si la configuration en vigueur la connaît. */
  recipe(recipeId: string): SiteRecipe | null;
  /**
   * Entretien d'un jour du site qui exploite cette recette, en oboles (5.5) : ce que demande chaque
   * clôture, et ce que coûte une relance. Nul pour une recette inconnue, qui n'a pas de tarif.
   */
  upkeepOf(recipeId: string): number;
  /**
   * Prix d'une relance du site (5.5) : son entretien d'un jour plus les salaires de ses travailleurs au
   * salaire du jour de sa cité (`citySlug`, identifiant de la configuration ; `null` : inconnue, aucun
   * salaire). Avec le marché du travail du jour de la cité (`day`, #258), son salaire remplace celui des
   * règles, et chaque travailleur sans logement du site (`unhoused`) paie une nuit d'hébergement ; si
   * l'hébergement coûte et que ces travailleurs ne sont pas lus, aucun prix n'est annoncé. `null` aussi si
   * le calcul dépasse les entiers sûrs.
   */
  restartCostOf(
    recipeId: string,
    citySlug: string | null,
    day?: DayLabor,
    unhoused?: number,
  ): number | null;
}

/** Ce que la fiche d'un site lit des règles des intendants (`site_rules`, clé `stewards`). */
export interface StewardRules {
  limit: number;
  dailyWageOboles: number;
  rulesPerSteward: number;
  refusalRestTicks: number;
}

/** Salaire et hébergement du jour d'une cité (vue `labor_market`, #258). */
export interface DayLabor {
  wageOboles: number;
  lodgingOboles: number;
}

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/**
 * Marché du travail du jour de chaque cité, par identifiant de cité. Une ligne illisible est ignorée : la
 * cité garde alors le salaire des règles des sites, et l'API refuse un prix qui ne serait plus le bon.
 */
export function parseLaborMarket(rows: readonly unknown[] | null): Map<string, DayLabor> {
  const row = z.object({ city_id: name, wage_oboles: count, lodging_oboles: count });
  return new Map(
    (rows ?? []).flatMap((raw) => {
      const parsed = row.safeParse(raw);
      return parsed.success
        ? [
            [
              parsed.data.city_id,
              { wageOboles: parsed.data.wage_oboles, lodgingOboles: parsed.data.lodging_oboles },
            ] as const,
          ]
        : [];
    }),
  );
}

/** Travailleurs sans logement de chaque site de la maison (vue `my_workforce`, #258). */
export function parseWorkforce(rows: readonly unknown[] | null): Map<string, number> {
  const row = z.object({ site_id: name, unhoused: count });
  return new Map(
    (rows ?? []).flatMap((raw) => {
      const parsed = row.safeParse(raw);
      return parsed.success ? [[parsed.data.site_id, parsed.data.unhoused] as const] : [];
    }),
  );
}

/** Personnel d'un site de la maison : travailleurs requis par sa recette, logés ou non (#258). */
export interface SiteStaff {
  workers: number;
  housed: number;
  unhoused: number;
}

/**
 * Personnel de chaque site de la maison (vue `my_workforce`), par identifiant de site. Une ligne
 * illisible est ignorée : la fiche du site tait alors son personnel plutôt que d'en inventer un.
 */
export function parseSiteStaff(rows: readonly unknown[] | null): Map<string, SiteStaff> {
  const row = z.object({ site_id: name, workers: count, housed: count, unhoused: count });
  return new Map(
    (rows ?? []).flatMap((raw) => {
      const parsed = row.safeParse(raw);
      if (!parsed.success) return [];
      const { site_id, workers, housed, unhoused } = parsed.data;
      return [[site_id, { workers, housed, unhoused }] as const];
    }),
  );
}

/** Rend `null` si la réponse n'a pas la forme attendue : l'écran annonce alors un échec de lecture. */
export function parseSiteRules(raw: unknown): SiteRules | null {
  const parsed = siteRulesSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { recipes, sites } = parsed.data;
  const staff = 'staff' in sites ? sites.staff : undefined;
  const stewards = 'stewards' in sites ? sites.stewards : undefined;
  const clock = 'clock' in sites ? sites.clock : undefined;
  // `Map` : un type de site nommé comme une propriété d'objet (« constructor ») n'a pas de prix.
  const costs = new Map(Object.entries(sites.acquisitionCostOboles));
  const typeOf = (recipeId: string) =>
    recipes.find((recipe) => recipe.id === recipeId)?.siteType ?? null;
  const upkeepOf = (recipeId: string) => {
    const base = new Map(Object.entries(sites.upkeep.dailyOboles)).get(typeOf(recipeId) ?? '');
    return base === undefined ? 0 : dailyUpkeep(base, sites.upkeep.coefficientBps);
  };
  return {
    limit: sites.limitByHeadquartersLevel[0] ?? 0,
    stewards: {
      limit: stewards?.limitByHeadquartersLevel[0] ?? 0,
      dailyWageOboles: stewards?.dailyWageOboles ?? 0,
      rulesPerSteward: stewards?.rulesPerSteward ?? 0,
      refusalRestTicks: stewards?.refusalRestTicks ?? DEFAULT_STEWARD_REFUSAL_REST_TICKS,
    },
    tickMinutes: clock?.tickMinutes ?? null,
    offers: recipes.flatMap((recipe) => {
      const costOboles = costs.get(recipe.siteType);
      return costOboles === undefined ? [] : [{ recipe, costOboles }];
    }),
    siteTypeOf: typeOf,
    alternatives: (recipeId) => {
      const type = typeOf(recipeId);
      if (type === null) return recipes;
      return recipes.filter((recipe) => recipe.siteType === type && recipe.id !== recipeId);
    },
    recipe: (recipeId) => recipes.find((recipe) => recipe.id === recipeId) ?? null,
    upkeepOf,
    restartCostOf: (recipeId, citySlug, day, unhoused) => {
      const recipe = recipes.find((candidate) => candidate.id === recipeId);
      if (!recipe) return 0;
      const wages = new Map(Object.entries(staff?.dailyWageOboles ?? {}));
      const wage = day ? day.wageOboles : (wages.get(citySlug ?? '') ?? 0);
      const lodging = day && recipe.workers > 0 ? day.lodgingOboles : 0;
      if (lodging > 0 && unhoused === undefined) return null;
      try {
        const cost =
          upkeepOf(recipeId) +
          dailyWages(recipe.workers, wage) +
          dailyWages(Math.min(unhoused ?? 0, recipe.workers), lodging);
        return Number.isSafeInteger(cost) ? cost : null;
      } catch {
        return null;
      }
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

/**
 * Avancement du cycle en cours d'un site, pour l'affichage : part faite (de 0 à 1) et minutes avant le
 * prochain cycle. Plafond d'accumulation atteint (`full`), le temps ne produit plus rien. À l'arrêt, le
 * temps s'est arrêté à l'instant de l'arrêt, comme pour `previewHarvest`.
 */
export function cycleProgress(
  recipe: SiteRecipe,
  cycleStartedAt: Date,
  now: Date,
  haltedAt: Date | null = null,
): { done: number; minutesLeft: number; full: boolean } {
  const until = haltedAt && haltedAt < now ? haltedAt : now;
  const cycle = recipe.durationMinutes * 60_000;
  const elapsed = Math.max(0, until.getTime() - cycleStartedAt.getTime());
  if (elapsed >= cycle * recipe.maxAccruedCycles) return { done: 1, minutesLeft: 0, full: true };
  const current = elapsed % cycle;
  return { done: current / cycle, minutesLeft: Math.ceil((cycle - current) / 60_000), full: false };
}

export interface StockLine {
  city_id: string;
  good_id: string;
  quantity: number;
  reserved: number;
}

/**
 * Lignes de stock regroupées par cité : celle de la maison d'abord, puis les autres dans l'ordre où
 * elles paraissent. L'ordre des lignes est gardé dans chaque cité.
 */
export function stockByCity<T extends { city_id: string }>(
  lines: readonly T[],
  homeCityId: string,
): { cityId: string; lines: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const line of lines) {
    const group = groups.get(line.city_id);
    if (group) group.push(line);
    else groups.set(line.city_id, [line]);
  }
  const home = groups.get(homeCityId);
  const others = [...groups].filter(([cityId]) => cityId !== homeCityId);
  return [
    ...(home ? [{ cityId: homeCityId, lines: home }] : []),
    ...others.map(([cityId, group]) => ({ cityId, lines: group })),
  ];
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

/**
 * Ce qui demande l'attention du joueur sur un site, dans l'ordre où il faut y répondre. `retired` : la
 * recette du site a quitté la configuration, il ne produit plus tant qu'il n'en a pas changé (4.2).
 */
export type SiteAlert = 'retired' | 'halted' | 'short' | 'full';

/**
 * Alertes d'un site, déduites de ce qu'une récolte donnerait maintenant (`previewHarvest`) :
 * - `halted` : entretien impayé, le site ne produit plus ; seule alerte d'un site à l'arrêt, puisque
 *   rien d'autre n'y change tant qu'il n'est pas relancé ;
 * - `short` : un atelier a des cycles écoulés qui attendent des intrants ;
 * - `full` : le plafond d'accumulation est atteint, le temps qui passe ne produit plus rien.
 */
export function siteAlerts(recipe: SiteRecipe, harvest: Harvest, halted: boolean): SiteAlert[] {
  if (halted) return ['halted'];
  const alerts: SiteAlert[] = [];
  if (harvest.waiting > 0) alerts.push('short');
  if (harvest.cycles + harvest.waiting >= recipe.maxAccruedCycles) alerts.push('full');
  return alerts;
}
