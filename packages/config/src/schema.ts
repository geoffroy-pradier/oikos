import { z } from 'zod';

/** Identifiant stable d'une ligne de configuration : minuscules, chiffres, tirets bas. */
const id = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const positiveInt = z.number().int().positive();
const MINUTES_PER_DAY = 1440;
/** Constante de l'univers, pas d'équilibrage (docs/glossary.md) : 6 oboles font 1 drachme. */
export const OBOLS_PER_DRACHMA = 6;

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value === 'UTC' || (value.trim() === value && value.includes('/'));
  } catch {
    return false;
  }
}

export const GOOD_TIERS = ['raw', 'intermediate', 'finished', 'service'] as const;
export const SITE_TYPES = [
  'field',
  'orchard',
  'pasture',
  'forest',
  'quarry',
  'fishery',
  'workshop',
] as const;
export const NEED_LEVELS = ['vital', 'comfort', 'luxury'] as const;

/** Un bien du catalogue (docs/specs/05-economie.md, 5.1). */
export const goodSchema = z.strictObject({
  id,
  tier: z.enum(GOOD_TIERS),
  /** Prix de référence initial, en oboles. */
  referencePriceOboles: positiveInt,
  /** Élasticité-prix ε de la demande finale (5.2). */
  elasticity: z.number().positive().max(5),
});

const stack = z.strictObject({ goodId: id, quantity: positiveInt });

/**
 * Une recette : intrants, durée, personnel, extrants (4.3). Une recette sans intrant est une production primaire.
 * Lue par les joueurs (vue `public.site_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const recipeSchema = z.strictObject({
  id,
  siteType: z.enum(SITE_TYPES),
  inputs: z.array(stack),
  outputs: z.array(stack).min(1),
  durationMinutes: positiveInt,
  workers: z.number().int().nonnegative(),
  /** Capacité de stockage du site : nombre de cycles accumulés au plus en l'absence du joueur. */
  maxAccruedCycles: positiveInt,
});

/** Une classe de revenu des PNJ et son panier de besoins (5.2). */
export const npcClassSchema = z.strictObject({
  id,
  /** Sensibilité β à la qualité. */
  qualitySensitivity: z.number().min(0).max(1),
  /**
   * Revenu de la classe, en oboles par tick pour 1 000 habitants : plafond de sa dépense (5.2).
   * Réparti entre les biens du panier au prorata de leur dépense de référence (Q0 × prix de référence).
   */
  incomePerThousand: positiveInt,
  basket: z
    .array(
      z.strictObject({
        goodId: id,
        need: z.enum(NEED_LEVELS),
        /** Q0 : quantité demandée par tick (de `clock.tickMinutes`) pour 1 000 habitants, au prix de référence. */
        quantityPerThousand: z.number().positive(),
      }),
    )
    .min(1),
});

export const cityConfigSchema = z.strictObject({
  id,
  /** Population de PNJ par classe. */
  // Au plus 100 millions par classe : la limite de calcul exact de `nextPopulation` (packages/sim).
  population: z.record(id, z.number().int().nonnegative().max(100_000_000)),
});

/** Horloges du monde (docs/specs/03-boucles-progression.md). */
export const clockSchema = z.strictObject({
  /**
   * Durée du tick : un diviseur de l'heure (donc de la journée). Le tick de clôture est le premier qui
   * commence à la clôture ou après (`isDailyClose`) : dans un fuseau décalé d'une demi-heure ou d'un quart
   * d'heure, il peut commencer un peu après elle. Ne change pas d'une version à l'autre (#123).
   */
  tickMinutes: positiveInt
    .refine((minutes) => MINUTES_PER_DAY % minutes === 0, {
      message: 'must divide the 1440 minutes of a day',
    })
    // Les fuseaux à décalage d'une demi-heure existent : un tick doit toujours commencer une heure locale.
    .refine((minutes) => 60 % minutes === 0, { message: 'must divide the 60 minutes of an hour' }),
  dailyCloseHour: z.number().int().min(0).max(23),
  /** Identifiant IANA, par exemple `Europe/Paris`. */
  timezone: z.string().refine(isTimezone, { message: 'unknown IANA time zone' }),
  seasonDays: positiveInt,
});

function duplicates(ids: string[]): string[] {
  return [...new Set(ids.filter((value, index) => ids.indexOf(value) !== index))];
}

/** Paramètres de marché (docs/specs/05-economie.md, 5.2). */
export const marketSchema = z.strictObject({
  /**
   * Prix de réserve des PNJ : au-delà de ce multiple du prix de référence d'un bien, ils n'achètent pas.
   * Sans lui, un vendeur seul capterait tout le budget d'un bien avec une unité vendue à prix démesuré.
   */
  npcMaxPriceFactor: z.number().min(1).max(100),
});

/** Dotation d'une maison à sa fondation (docs/specs/03-boucles-progression.md). */
export const startingSchema = z.strictObject({
  /** Monnaie versée par le robinet `faucet_starting_grant`, en oboles. */
  grantOboles: positiveInt,
  /** Recette du premier site reçu : une production primaire, exploitable sans rien acheter. */
  siteRecipeId: id,
});

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Valeurs lues pour les versions publiées avant l'entretien des sites : elles ne prélevaient rien.
 * FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_UPKEEP = deepFreeze({
  coefficientBps: 10_000,
  dailyOboles: { field: 0, orchard: 0, pasture: 0, forest: 0, quarry: 0, fishery: 0, workshop: 0 },
});

/**
 * Entretien quotidien des sites, prélevé à la clôture et détruit (puits `sink_upkeep`, 5.5).
 * Dû par site : ⌈dailyOboles[type] × coefficientBps ÷ 10 000⌉.
 */
export const upkeepSchema = z.strictObject({
  /**
   * Coefficient d'entretien global, en points de base (10 000 = ×1), de ×0 à ×10 : l'un des trois
   * leviers d'inflation, qui se règle sans retoucher chaque type de site.
   */
  coefficientBps: z.number().int().min(0).max(100_000),
  /** Entretien de base par jour de jeu, en oboles, pour chaque type de site. Nul : pas d'entretien. */
  dailyOboles: z.record(z.enum(SITE_TYPES), z.number().int().min(0).max(1_000_000_000)),
});

/**
 * Valeurs lues pour les versions publiées avant que la section `sites` n'existe. FIGÉES : les changer
 * changerait après coup le prix d'une version immuable, et le rejeu d'un tick avec sa version
 * enregistrée divergerait. Un rééquilibrage passe par une nouvelle version de configuration, jamais
 * par cette constante.
 */
export const DEFAULT_SITES = deepFreeze({
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
  upkeep: DEFAULT_UPKEEP,
});

/**
 * Sites d'une maison (docs/specs/04-systemes-gestion.md, 4.1 et 4.2).
 * Lue par les joueurs (vue `public.site_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const sitesSchema = z.strictObject({
  /**
   * Nombre de sites qu'une maison peut exploiter, par niveau de siège (le premier d'abord). Seul le
   * premier niveau existe pour l'instant : toute maison est au niveau 1.
   */
  limitByHeadquartersLevel: z.array(positiveInt).min(1).max(10),
  /** Prix d'acquisition d'un site, en oboles, pour chaque type de site. La monnaie est détruite. */
  acquisitionCostOboles: z.record(z.enum(SITE_TYPES), positiveInt),
  /** Absent d'une version publiée avant l'entretien : elle reste lisible, sans entretien. */
  upkeep: upkeepSchema.default(DEFAULT_UPKEEP),
});

/**
 * Valeurs lues pour les versions publiées avant la taxe de marché : elles ne taxaient rien. FIGÉES, pour
 * la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_MARKET_TAX = deepFreeze({ rateBps: 0, burnShareBps: 10_000 });

/**
 * Taxe de marché, prélevée sur le vendeur à chaque échange de l'agora (5.3, 5.6). Taux en points de
 * base (1 pour 10 000) : le calcul reste en entiers, arrondi compris.
 * Lue par les joueurs (vue `public.market_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const marketTaxSchema = z.strictObject({
  /** Taux de la taxe sur le montant brut d'un échange. Borné : au-delà, vendre ne paie plus. */
  rateBps: z.number().int().min(0).max(5000),
  /** Part de la taxe détruite (puits `sink_market_tax`) ; le reste va au trésor de la cité. */
  burnShareBps: z.number().int().min(0).max(10_000),
});

/**
 * Valeurs lues pour les versions publiées avant la dynamique de population : la population des PNJ ne
 * bouge pas (aucune croissance, aucune émigration, bornes égales à la population initiale). FIGÉES, pour
 * la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_POPULATION_DYNAMICS = deepFreeze({
  vitalCoverageThresholdBps: 10_000,
  growthBps: 0,
  emigrationBps: 0,
  minShareBps: 10_000,
  maxShareBps: 10_000,
});

/**
 * Dynamique de la population des PNJ (5.2), appliquée à chaque clôture quotidienne par classe et par
 * cité, d'après la couverture du jour de ses besoins vitaux (quantités servies sur quantités demandées).
 * Points de base : au-dessus du seuil la classe croît, jusqu'à `growthBps` par jour à 100 % ; en
 * dessous elle émigre, jusqu'à `emigrationBps` par jour à 0 %. Bornes en points de base de la
 * population initiale de la cité. Calcul : `nextPopulation` (packages/sim).
 */
export const populationDynamicsSchema = z.strictObject({
  vitalCoverageThresholdBps: z.number().int().min(1).max(10_000),
  growthBps: z.number().int().min(0).max(1_000),
  emigrationBps: z.number().int().min(0).max(1_000),
  minShareBps: z.number().int().min(0).max(10_000),
  maxShareBps: z.number().int().min(10_000).max(100_000),
});

/**
 * Valeurs lues pour les versions publiées avant l'historique des prix. FIGÉES, pour la même raison que
 * `DEFAULT_SITES`.
 */
export const DEFAULT_PRICE_HISTORY = deepFreeze({ candleMinutes: 60, referenceWindowHours: 24 });

/**
 * Historique des prix de l'agora (5.3).
 * Lue par les joueurs (vue `public.market_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const priceHistorySchema = z.strictObject({
  /**
   * Durée d'un chandelier, en minutes, d'une minute à une journée. La changer ouvre une nouvelle série,
   * recalculée depuis les échanges ; l'ancienne reste telle quelle.
   */
  candleMinutes: z.number().int().min(1).max(1440),
  /**
   * Fenêtre du prix de référence observé, en heures : le prix moyen des échanges de cette durée, d'une
   * heure à trente jours. Absente d'une version publiée avant lui : 24 heures.
   */
  referenceWindowHours: z
    .number()
    .int()
    .min(1)
    .max(720)
    .default(DEFAULT_PRICE_HISTORY.referenceWindowHours),
});

/**
 * Valeurs lues pour les versions publiées avant l'indice des prix : la cible de la règle de conception
 * (5.5) et un panier vide, donc un indice inconnu. FIGÉES, pour la même raison que `DEFAULT_SITES`.
 */
export const DEFAULT_PRICE_INDEX = deepFreeze({
  windowDays: 30,
  inflationTargetBps: { min: 0, max: 300 },
  basket: [] as { goodId: string; quantity: number }[],
});

/** Indice des prix et mesure de l'inflation du tableau de bord économique (5.5). Rien du jeu ne s'y règle. */
export const priceIndexSchema = z.strictObject({
  /** Fenêtre de mesure, en jours : l'inflation compare cette fenêtre à celle qui la précède. */
  windowDays: z.number().int().min(1).max(365),
  /** Cible d'inflation sur la fenêtre, en points de base, bornes comprises ; hors d'elle, alerte. */
  inflationTargetBps: z
    .strictObject({
      min: z.number().int().min(-10_000).max(10_000),
      max: z.number().int().min(-10_000).max(10_000),
    })
    .refine((target) => target.min <= target.max, { message: 'min must not exceed max' }),
  /** Panier de référence : quantités fixes de biens, dont l'indice suit le coût. Vide : indice inconnu. */
  basket: z.array(stack).max(100),
});

export const gameConfigSchema = z
  .strictObject({
    clock: clockSchema,
    market: marketSchema,
    starting: startingSchema,
    /**
     * Absent des versions publiées avant l'acquisition de sites : elles restent lisibles, avec les
     * valeurs de départ ci-dessus. Toute version publiée depuis le porte explicitement.
     */
    sites: sitesSchema.default(DEFAULT_SITES),
    /** Absent des versions publiées avant la taxe de marché : elles restent lisibles, sans taxe. */
    marketTax: marketTaxSchema.default(DEFAULT_MARKET_TAX),
    /** Absent des versions publiées avant l'historique des prix : chandeliers d'une heure. */
    priceHistory: priceHistorySchema.default(DEFAULT_PRICE_HISTORY),
    /** Absent des versions publiées avant la dynamique de population : population constante. */
    populationDynamics: populationDynamicsSchema.default(DEFAULT_POPULATION_DYNAMICS),
    /** Absent des versions publiées avant l'indice des prix : cible de la spécification, panier vide. */
    priceIndex: priceIndexSchema.default(DEFAULT_PRICE_INDEX),
    goods: z.array(goodSchema).min(1),
    recipes: z.array(recipeSchema),
    npcClasses: z.array(npcClassSchema).min(1),
    cities: z.array(cityConfigSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const goods = new Set(config.goods.map((good) => good.id));
    const classes = new Set(config.npcClasses.map((npcClass) => npcClass.id));

    // Une fenêtre plus courte qu'un chandelier n'en retiendrait aucun une partie du temps, sans erreur.
    // Une fenêtre déjà hors bornes a son propre message : pas de second reproche.
    const { candleMinutes, referenceWindowHours } = config.priceHistory;
    if (referenceWindowHours >= 1 && referenceWindowHours * 60 < candleMinutes) {
      issue(
        ['priceHistory', 'referenceWindowHours'],
        `the window must last at least one candle (${candleMinutes} minutes)`,
      );
    }
    for (const key of ['goods', 'recipes', 'npcClasses', 'cities'] as const) {
      for (const duplicate of duplicates(config[key].map((row) => row.id))) {
        issue([key], `duplicate id "${duplicate}"`);
      }
    }
    config.recipes.forEach((recipe, index) => {
      const consumed = new Set(recipe.inputs.map((entry) => entry.goodId));
      recipe.outputs.forEach((entry, position) => {
        if (consumed.has(entry.goodId)) {
          issue(
            ['recipes', index, 'outputs', position, 'goodId'],
            `good "${entry.goodId}" is both consumed and produced`,
          );
        }
      });
      for (const side of ['inputs', 'outputs'] as const) {
        for (const duplicate of duplicates(recipe[side].map((entry) => entry.goodId))) {
          issue(['recipes', index, side], `duplicate good "${duplicate}"`);
        }
        recipe[side].forEach((entry, position) => {
          if (!goods.has(entry.goodId)) {
            issue(['recipes', index, side, position, 'goodId'], `unknown good "${entry.goodId}"`);
          }
        });
      }
    });
    const startingRecipe = config.recipes.find(
      (recipe) => recipe.id === config.starting.siteRecipeId,
    );
    if (!startingRecipe) {
      issue(['starting', 'siteRecipeId'], `unknown recipe "${config.starting.siteRecipeId}"`);
    } else if (startingRecipe.inputs.length > 0) {
      issue(['starting', 'siteRecipeId'], 'the starting site must run a recipe without inputs');
    }
    for (const duplicate of duplicates(config.priceIndex.basket.map((entry) => entry.goodId))) {
      issue(['priceIndex', 'basket'], `duplicate good "${duplicate}"`);
    }
    config.priceIndex.basket.forEach((entry, position) => {
      if (!goods.has(entry.goodId)) {
        issue(['priceIndex', 'basket', position, 'goodId'], `unknown good "${entry.goodId}"`);
      }
    });
    config.npcClasses.forEach((npcClass, index) => {
      for (const duplicate of duplicates(npcClass.basket.map((entry) => entry.goodId))) {
        issue(['npcClasses', index, 'basket'], `duplicate good "${duplicate}"`);
      }
      npcClass.basket.forEach((entry, position) => {
        if (!goods.has(entry.goodId)) {
          issue(
            ['npcClasses', index, 'basket', position, 'goodId'],
            `unknown good "${entry.goodId}"`,
          );
        }
      });
    });
    config.cities.forEach((city, index) => {
      for (const classId of Object.keys(city.population)) {
        if (!classes.has(classId)) {
          issue(['cities', index, 'population', classId], `unknown NPC class "${classId}"`);
        }
      }
      for (const classId of classes) {
        if (!Object.hasOwn(city.population, classId)) {
          issue(['cities', index, 'population'], `missing NPC class "${classId}"`);
        }
      }
    });
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type Good = z.infer<typeof goodSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type NpcClass = z.infer<typeof npcClassSchema>;
