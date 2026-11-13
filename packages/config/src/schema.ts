import { z } from 'zod';

/** Identifiant stable d'une ligne de configuration : minuscules, chiffres, tirets bas. */
const id = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const positiveInt = z.number().int().positive();
const MINUTES_PER_DAY = 1440;

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

/** Une recette : intrants, durée, personnel, extrants (4.3). Une recette sans intrant est une production primaire. */
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
  population: z.record(id, z.number().int().nonnegative()),
});

/** Horloges du monde (docs/specs/03-boucles-progression.md). */
export const clockSchema = z.strictObject({
  /** Durée du tick : un diviseur de l'heure (donc de la journée), pour que la clôture tombe toujours sur un tick. */
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

export const gameConfigSchema = z
  .strictObject({
    clock: clockSchema,
    market: marketSchema,
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
