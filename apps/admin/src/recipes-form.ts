import { editRow, readRows, withRows, type Row, type TableField } from './goods-form';
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
export type RecipeSide = (typeof RECIPE_SIDES)[number];
/** Champs d'une ligne d'intrant ou d'extrant. */
export const STACK_FIELDS = [
  { key: 'goodId', kind: 'text' },
  { key: 'quantity', kind: 'integer' },
] as const;
/** Types de site proposés : ceux qui ont un libellé. Un test vérifie qu'ils sont ceux du schéma. */
export const SITE_TYPES = Object.keys(en.config.recipesForm.siteTypes);

/**
 * Recettes d'une configuration (`readRows`). `null` aussi quand une liste d'intrants ou d'extrants est
 * présente sans être une liste d'objets : le formulaire ne montre pas une recette à moitié.
 */
export function readRecipes(config: unknown): Row[] | null {
  const recipes = readRows(config, 'recipes');
  const readable = recipes?.every((recipe) => RECIPE_SIDES.every((side) => readRows(recipe, side)));
  return readable ? recipes : null;
}

/** Recettes après une saisie dans une ligne d'intrant ou d'extrant : seule cette valeur change. */
export function editStack(
  recipes: Row[],
  row: number,
  side: RecipeSide,
  line: number,
  field: TableField,
  input: string,
): Row[] {
  return recipes.map((recipe, index) => {
    const lines = index === row && Object.hasOwn(recipe, side) ? readRows(recipe, side) : null;
    return lines ? withRows(recipe, side, editRow(lines, line, field, input)) : recipe;
  });
}

/** Identifiants des biens du texte, sans doublon : de simples suggestions pour le champ « bien ». */
export function goodIds(config: unknown): string[] {
  const ids = (readRows(config, 'goods') ?? []).map((good) => good['id']);
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
}
