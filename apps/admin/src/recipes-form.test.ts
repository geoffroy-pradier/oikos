import { recipeSchema, SITE_TYPES as SCHEMA_SITE_TYPES } from '@oikos/config/schema';
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { composeTable, editRow, typed } from './goods-form';
import * as form from './recipes-form';

const { editStack, goodIds, readRecipes, RECIPE_FIELDS, RECIPE_SIDES, STACK_FIELDS } = form;
type Recipes = { recipes: Record<string, Record<string, unknown>[]>[] };

it('les champs, les listes, les lignes et les types de site du formulaire sont ceux du schéma, dans son ordre', () => {
  const keys = Object.keys(recipeSchema.shape);
  expect(RECIPE_FIELDS.map((field) => field.key)).toEqual(
    keys.filter((key) => !(RECIPE_SIDES as readonly string[]).includes(key)),
  );
  expect(keys.filter((key) => (RECIPE_SIDES as readonly string[]).includes(key))).toEqual([
    ...RECIPE_SIDES,
  ]);
  for (const side of RECIPE_SIDES)
    expect(STACK_FIELDS.map((field) => field.key)).toEqual(
      Object.keys(recipeSchema.shape[side].element.shape),
    );
  expect(form.SITE_TYPES).toEqual([...SCHEMA_SITE_TYPES]);
});

it('sans liste de recettes lisible, ou avec des intrants ou extrants illisibles, pas de formulaire', () => {
  const sides = [{ inputs: {} }, { outputs: [1] }, { inputs: null }, { outputs: [[]] }];
  for (const recipe of sides) expect(readRecipes({ recipes: [{ id: 'a' }, recipe] })).toBeNull();
  for (const config of [null, [], { recipes: {} }, { recipes: [1] }])
    expect(readRecipes(config)).toBeNull();
  // Sans liste : rien à montrer. Une liste absente d'une recette est vide, pas illisible.
  expect(readRecipes({ goods: [] })).toEqual([]);
  expect(readRecipes({ recipes: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
});

it('suggestions du champ « bien » : les identifiants des biens du texte, sans doublon ni valeur d’un autre type', () => {
  const goods = [{ id: 'wheat' }, { id: 'bread' }, { id: 'wheat' }, { id: 7 }, { id: '' }, {}];
  expect(goodIds({ goods })).toEqual(['wheat', 'bread']);
  expect(goodIds({ goods: 'wheat' })).toEqual([]);
});

it('une saisie dans une ligne absente ne crée pas sa liste', () => {
  const recipes = [{ id: 'gather', outputs: [] }];
  expect(editStack(recipes, 0, 'inputs', 0, STACK_FIELDS[1], '3')).toEqual(recipes);
  expect(editStack(recipes, 0, 'outputs', 0, STACK_FIELDS[1], '3')).toEqual(recipes);
});

it('conservation : une saisie dans une recette ou dans une de ses lignes ne change que sa valeur, ordre des clés compris', () => {
  const json = fc.jsonValue();
  const lines = fc.array(fc.dictionary(fc.string(), json), { minLength: 1 });
  const recipe = fc.record({ id: json, inputs: lines, outputs: lines, extra: json });
  // Une recette sans liste : clés quelconques, sauf `inputs` et `outputs` (sans quoi elle serait illisible).
  const key = fc.string().filter((name) => !(RECIPE_SIDES as readonly string[]).includes(name));
  const source = fc.record({
    recipes: fc.array(fc.oneof(recipe, fc.dictionary(key, json)), { minLength: 1 }),
    rest: fc.dictionary(fc.string(), json),
  });
  const input = fc.oneof(fc.string(), fc.maxSafeInteger().map(String));
  // Une saisie vise un champ de la recette, ou un champ d'une ligne d'intrant ou d'extrant.
  const target = fc.oneof(
    fc.record({ field: fc.constantFrom(...RECIPE_FIELDS) }),
    fc.record({ field: fc.constantFrom(...STACK_FIELDS), side: fc.constantFrom(...RECIPE_SIDES) }),
  );
  fc.assert(
    fc.property(source, fc.nat(), fc.nat(), target, input, (data, pickRow, pickLine, aim, text) => {
      // Comme à l'écran : la configuration est lue d'un texte JSON.
      const before = JSON.stringify({ ...data.rest, recipes: data.recipes });
      const config = JSON.parse(before) as Recipes;
      const row = pickRow % config.recipes.length;
      const expected = JSON.parse(before) as Recipes;
      const recipe = expected.recipes[row] ?? {};
      const lines = 'side' in aim ? recipe[aim.side] : undefined;
      fc.pre(!('side' in aim) || (Array.isArray(lines) && lines.length > 0));
      const line = pickLine % (lines?.length ?? 1);
      const next =
        'side' in aim
          ? editStack(config.recipes, row, aim.side, line, aim.field, text)
          : editRow(config.recipes, row, aim.field, text);
      // Valeur attendue écrite à la main, à sa place : seule cette clé change, ou disparaît si vidée.
      const changed = (lines?.[line] ?? recipe) as Record<string, unknown>;
      const value = typed(aim.field.kind, text);
      if (value === undefined) Reflect.deleteProperty(changed, aim.field.key);
      else changed[aim.field.key] = value;
      expect(composeTable(config, 'recipes', next)).toBe(JSON.stringify(expected, null, 2));
      // Rien n'est modifié en place, et le texte écrit se relit dans le formulaire.
      expect(JSON.stringify(config)).toBe(before);
      expect(readRecipes(JSON.parse(composeTable(config, 'recipes', next)))).toEqual(next);
    }),
  );
});
