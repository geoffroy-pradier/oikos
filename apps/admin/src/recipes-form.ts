import { readNested, type Row } from './goods-form';
import en from './locales/en.json';

/** Champs d'une recette hors de ses listes, dans l'ordre du formulaire. Un test les compare au schéma. */
export const RECIPE_FIELDS = [
  { key: 'id', kind: 'text' },
  { key: 'siteType', kind: 'choice' },
  { key: 'durationMinutes', kind: 'integer' },
  { key: 'workers', kind: 'integer' },
  { key: 'maxAccruedCycles', kind: 'integer' },
] as const;
/** Listes d'une recette : intrants, extrants. */
export const RECIPE_SIDES = ['inputs', 'outputs'] as const;
/** Champs d'une ligne d'intrant ou d'extrant. */
export const STACK_FIELDS = [
  { key: 'goodId', kind: 'text' },
  { key: 'quantity', kind: 'integer' },
] as const;
/** Types de site proposés : ceux qui ont un libellé. Un test vérifie qu'ils sont ceux du schéma. */
export const SITE_TYPES = Object.keys(en.config.recipesForm.siteTypes);

/** Recettes d'une configuration, avec leurs intrants et extrants (`readNested`). */
export const readRecipes = (config: unknown): Row[] | null =>
  readNested(config, 'recipes', RECIPE_SIDES);
