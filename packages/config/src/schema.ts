import { z } from 'zod';

/** Identifiant stable d'une ligne de configuration : minuscules, chiffres, tirets bas. */
const id = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const positiveInt = z.number().int().positive();

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

/** Une recette : intrants, durée, personnel, extrants (4.3). Une production primaire n'a pas d'intrant. */
export const recipeSchema = z.strictObject({
  id,
  siteType: z.enum(SITE_TYPES),
  inputs: z.array(stack),
  outputs: z.array(stack).min(1),
  durationMinutes: positiveInt,
  workers: z.number().int().nonnegative(),
});

/** Une classe de revenu des PNJ et son panier de besoins (5.2). */
export const npcClassSchema = z.strictObject({
  id,
  /** Sensibilité β à la qualité. */
  qualitySensitivity: z.number().min(0).max(1),
  basket: z
    .array(
      z.strictObject({
        goodId: id,
        need: z.enum(NEED_LEVELS),
        /** Q0 : quantité demandée par tick pour 1 000 habitants, au prix de référence. */
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
  tickMinutes: positiveInt.max(1440),
  dailyCloseHour: z.number().int().min(0).max(23),
  timezone: z.string().min(1),
  seasonDays: positiveInt,
});

function duplicates(ids: string[]): string[] {
  return [...new Set(ids.filter((value, index) => ids.indexOf(value) !== index))];
}

export const gameConfigSchema = z
  .strictObject({
    clock: clockSchema,
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
      for (const side of ['inputs', 'outputs'] as const) {
        recipe[side].forEach((entry, position) => {
          if (!goods.has(entry.goodId)) {
            issue(['recipes', index, side, position, 'goodId'], `unknown good "${entry.goodId}"`);
          }
        });
      }
    });
    config.npcClasses.forEach((npcClass, index) => {
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
        if (!(classId in city.population)) {
          issue(['cities', index, 'population'], `missing NPC class "${classId}"`);
        }
      }
    });
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type Good = z.infer<typeof goodSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type NpcClass = z.infer<typeof npcClassSchema>;
