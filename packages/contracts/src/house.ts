import { z } from 'zod';

/** Nom de maison : 3 à 24 caractères, lettres, espaces, apostrophes, tirets ; commence et finit par une lettre. */
export const HOUSE_NAME_PATTERN = /^\p{L}[\p{L} '-]{1,22}\p{L}$/u;

/** Normalise une saisie avant validation : forme NFC, apostrophe typographique des claviers mobiles, espaces de bord. */
export function normalizeHouseName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

export const houseNameSchema = z.string().regex(HOUSE_NAME_PATTERN);

export const BLAZON_SHAPES = ['hoplon', 'pelte', 'thyreos'] as const;
export const BLAZON_TINCTURES = ['terracotta', 'black', 'ochre', 'aegean'] as const;
export const BLAZON_EMBLEMS = ['owl', 'trident', 'olive', 'amphora', 'sun', 'ship'] as const;

/** Blason simple : une forme de bouclier, une couleur de fond, un emblème. */
export const blazonSchema = z.strictObject({
  shape: z.enum(BLAZON_SHAPES),
  tincture: z.enum(BLAZON_TINCTURES),
  emblem: z.enum(BLAZON_EMBLEMS),
});
export type Blazon = z.infer<typeof blazonSchema>;

/** Commande `house.create` : fonde la maison du joueur dans sa cité d'accueil. */
export const houseCreateInputSchema = z.strictObject({
  cityId: z.uuid(),
  name: houseNameSchema,
  blazon: blazonSchema,
});
export type HouseCreateInput = z.infer<typeof houseCreateInputSchema>;

export const houseCreateOutputSchema = z.object({
  houseId: z.uuid(),
  worldId: z.uuid(),
  cityId: z.uuid(),
  name: z.string(),
  citizenshipStatus: z.enum(['metic', 'citizen']),
});
export type HouseCreateOutput = z.infer<typeof houseCreateOutputSchema>;

export const HOUSE_CREATE_ERROR_CODES = [
  'CITY_NOT_FOUND',
  'HOUSE_ALREADY_EXISTS',
  'HOUSE_NAME_TAKEN',
] as const;
export type HouseCreateErrorCode = (typeof HOUSE_CREATE_ERROR_CODES)[number];

/** Commande `house.rename` : change le nom de la maison du joueur. */
export const houseRenameInputSchema = z.strictObject({ name: houseNameSchema });
export type HouseRenameInput = z.infer<typeof houseRenameInputSchema>;

export const houseRenameOutputSchema = z.object({ houseId: z.uuid(), name: z.string() });
export type HouseRenameOutput = z.infer<typeof houseRenameOutputSchema>;

export const HOUSE_RENAME_ERROR_CODES = ['HOUSE_NOT_FOUND', 'HOUSE_NAME_TAKEN'] as const;
export type HouseRenameErrorCode = (typeof HOUSE_RENAME_ERROR_CODES)[number];
