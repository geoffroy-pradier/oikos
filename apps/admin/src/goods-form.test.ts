import {
  goodSchema,
  npcClassSchema,
  recipeSchema,
  GOOD_TIERS as SCHEMA_TIERS,
} from '@oikos/config/schema';
import fc from 'fast-check';
import { expect, it } from 'vitest';
import * as form from './goods-form';
import { BASKET_FIELDS, NPC_CLASS_FIELDS } from './npc-classes-form';
import { RECIPE_FIELDS, STACK_FIELDS } from './recipes-form';

const { addRow, composeGoods, editRow, GOOD_FIELDS, readGoods, removeRow, shown, typed } = form;
type Kind = form.TableField['kind'];

it('les champs et les niveaux du formulaire sont ceux du schéma, dans son ordre', () => {
  expect(GOOD_FIELDS.map((field) => field.key)).toEqual(Object.keys(goodSchema.shape));
  expect(form.GOOD_TIERS).toEqual([...SCHEMA_TIERS]);
});

it.each<[Kind, string, unknown]>([
  ['integer', ' -12 ', -12],
  ['decimal', '0,45', 0.45],
  ['decimal', '1.000', 1],
  // Ni un autre nombre (2^53 + 1 s'arrondirait), ni `null` (ce que JSON écrit pour l'infini).
  ['integer', '9007199254740993', '9007199254740993'],
  ['decimal', '1e999', '1e999'],
  ['text', ' 12 ', ' 12 '],
  // Champ vidé : la clé est retirée.
  ['integer', '', undefined],
  ['text', '', undefined],
])('saisie dans un champ %s : « %s »', (kind, input, expected) => {
  expect(typed(kind, input)).toBe(expected);
});

// Prix en oboles, jamais deviné : milliers, décimales, exposant, point final ou zéro en tête, c'est un texte.
const KEPT = ['1.000', '1,000', '1 200', '1e3', '5.', '007', '1.5', '.5', '0x10', '+5', ' ', '१२'];
it.each(KEPT)('dans un champ entier, « %s » reste un texte, que l’API refusera', (input) => {
  expect(typed('integer', input)).toBe(input);
});

it('une valeur d’un autre type que celui du champ est montrée en JSON, une valeur absente est vide', () => {
  const all = (kind: Kind, ...values: unknown[]) => values.map((value) => shown(kind, value));
  expect(all('integer', 12, -0.5, '12', null)).toEqual(['12', '-0.5', '"12"', 'null']);
  expect(all('text', 'wheat', 7, undefined)).toEqual(['wheat', '7', '']);
});

it('un nombre affiché se relit tel quel, sauf un entier que JSON ne porte pas exactement et, dans un champ entier, tout ce qui n’est pas un entier', () => {
  const number = fc.oneof(fc.maxSafeInteger(), fc.double({ noNaN: true, noDefaultInfinity: true }));
  fc.assert(
    fc.property(number, (value) => {
      fc.pre(!Object.is(value, -0));
      const exact = !Number.isInteger(value) || Number.isSafeInteger(value);
      expect(typed('decimal', shown('decimal', value))).toBe(exact ? value : String(value));
      const kept = Number.isSafeInteger(value) ? value : String(value);
      expect(typed('integer', shown('integer', value))).toBe(kept);
    }),
  );
});

it('sans liste de biens lisible, pas de formulaire ; sans `goods`, liste vide', () => {
  const unreadable = [undefined, null, 'texte', [], { goods: null }, { goods: {} }, { goods: [1] }];
  for (const config of [...unreadable, { goods: [{}, []] }]) expect(readGoods(config)).toBeNull();
  expect(readGoods({ recipes: [] })).toEqual([]);
});

it('une clé `__proto__` du texte reste une donnée : gardée telle quelle, à la racine et dans un bien', () => {
  const kept = '{"__proto__":{"a":1},"goods":[{"__proto__":2,"extra":true}]}';
  const config = JSON.parse(kept.replace('"extra"', '"id":"wheat","extra"')) as { goods: never[] };
  expect(composeGoods(config, editRow(config.goods, 0, GOOD_FIELDS[0], ''))).toBe(
    JSON.stringify(JSON.parse(kept), null, 2),
  );
});

it('conservation : une saisie ne change que sa valeur, tout le reste de la configuration est gardé', () => {
  const json = fc.jsonValue();
  const known = { id: json, tier: json, referencePriceOboles: json, elasticity: json, extra: json };
  const good = fc.oneof(fc.record(known, { requiredKeys: [] }), fc.dictionary(fc.string(), json));
  const source = fc.record({
    goods: fc.array(good, { minLength: 1 }),
    rest: fc.dictionary(fc.string(), json),
  });
  const input = fc.oneof(fc.string(), fc.double().map(String), fc.maxSafeInteger().map(String));
  const field = fc.constantFrom(...GOOD_FIELDS);
  fc.assert(
    fc.property(source, fc.nat(), field, input, ({ goods, rest }, pick, field, text) => {
      // Comme à l'écran : la configuration est lue d'un texte JSON.
      const before = JSON.stringify({ ...rest, goods });
      const config = JSON.parse(before) as { goods: Record<string, unknown>[] };
      const row = pick % config.goods.length;
      const after = composeGoods(config, editRow(config.goods, row, field, text));
      const expected = JSON.parse(before) as typeof config;
      const value = typed(field.kind, text);
      if (value === undefined) Reflect.deleteProperty(expected.goods[row] ?? {}, field.key);
      else Object.assign(expected.goods[row] ?? {}, { [field.key]: value });
      // Texte entier comparé : valeurs, et ordre des clés à la racine comme dans chaque bien.
      expect(after).toBe(JSON.stringify(expected, null, 2));
      // Rien n'est modifié en place, et relire puis recomposer rend le même texte.
      expect(JSON.stringify(config)).toBe(before);
      expect(composeGoods(JSON.parse(after), readGoods(JSON.parse(after)) ?? [])).toBe(after);
    }),
  );
});

it('ajout : un bien vide en fin de liste, sans valeur inventée ; sans `goods`, la liste est créée en dernier', () => {
  expect(composeGoods({ a: 1, goods: [{ id: 'wheat' }], b: 2 }, addRow([{ id: 'wheat' }]))).toBe(
    JSON.stringify({ a: 1, goods: [{ id: 'wheat' }, {}], b: 2 }, null, 2),
  );
  expect(composeGoods({ recipes: [] }, addRow(readGoods({ recipes: [] }) ?? []))).toBe(
    JSON.stringify({ recipes: [], goods: [{}] }, null, 2),
  );
  // Le dernier bien retiré : liste vide, que l'API refuse (au moins un bien).
  expect(composeGoods({ goods: [{ id: 'wheat' }] }, removeRow([{ id: 'wheat' }], 0))).toBe(
    JSON.stringify({ goods: [] }, null, 2),
  );
});

it('conservation : un ajout ou un retrait ne touche que ce bien, le reste du texte est gardé, ordre des clés compris', () => {
  const json = fc.jsonValue();
  const source = fc.record({
    goods: fc.array(fc.dictionary(fc.string(), json)),
    rest: fc.dictionary(fc.string(), json),
  });
  fc.assert(
    fc.property(source, fc.nat(), fc.boolean(), ({ goods, rest }, pick, adding) => {
      fc.pre(adding || goods.length > 0);
      // Comme à l'écran : la configuration est lue d'un texte JSON.
      const before = JSON.stringify({ ...rest, goods });
      const config = JSON.parse(before) as { goods: Record<string, unknown>[] };
      const row = pick % Math.max(config.goods.length, 1);
      const next = adding ? addRow(config.goods) : removeRow(config.goods, row);
      const expected = JSON.parse(before) as typeof config;
      if (adding) expected.goods.push({});
      else expected.goods.splice(row, 1);
      expect(composeGoods(config, next)).toBe(JSON.stringify(expected, null, 2));
      // Rien n'est modifié en place.
      expect(JSON.stringify(config)).toBe(before);
    }),
  );
});

it('une autre table et une liste imbriquée se lisent et s’écrivent de même, à leur place, ordre des clés gardé', () => {
  const bake = { id: 'bake', inputs: [{ goodId: 'wheat' }], z: 2 };
  const config = { a: 1, recipes: [bake], b: 2 };
  expect(form.readRows(config, 'recipes')).toEqual([bake]);
  expect([form.readRows(bake, 'inputs'), form.readRows(bake, 'outputs')]).toEqual([
    [bake.inputs[0]],
    [],
  ]);
  for (const inputs of [{}, [1], null]) expect(form.readRows({ inputs }, 'inputs')).toBeNull();
  // Une liste présente reste à sa place ; une liste absente est ajoutée en dernier.
  const flour = [{ goodId: 'flour' }];
  expect(Object.keys(form.withRows(bake, 'inputs', flour))).toEqual(['id', 'inputs', 'z']);
  expect(Object.keys(form.withRows(bake, 'outputs', []))).toEqual(['id', 'inputs', 'z', 'outputs']);
  expect(form.composeTable(config, 'recipes', [form.withRows(bake, 'inputs', flour)])).toBe(
    JSON.stringify({ a: 1, recipes: [{ ...bake, inputs: flour }], b: 2 }, null, 2),
  );
});

/** Sorte qu'un champ doit avoir d'après son schéma : un « 1e3 » n'écrit un nombre que dans un décimal. */
const kindOf = (schema: unknown): string => {
  const { def, isInt } = schema as { def: { type: string; innerType?: unknown }; isInt?: boolean };
  // Un champ facultatif a la sorte de ce qu'il enveloppe ; vide, il est retiré du texte (`typed`).
  if (def.type === 'optional') return kindOf(def.innerType);
  if (def.type === 'number') return isInt ? 'integer' : 'decimal';
  return def.type === 'enum' ? 'choice' : 'text';
};
it.each([
  ['biens', GOOD_FIELDS, goodSchema.shape],
  ['recettes', RECIPE_FIELDS, recipeSchema.shape],
  ['intrants et extrants', STACK_FIELDS, recipeSchema.shape.inputs.element.shape],
  ['classes de PNJ', NPC_CLASS_FIELDS, npcClassSchema.shape],
  ['paniers', BASKET_FIELDS, npcClassSchema.shape.basket.element.shape],
] as const)(
  '%s : chaque champ a la sorte de son schéma (entier, décimal, choix, texte)',
  (_, fields, shape) => {
    for (const field of fields)
      expect([field.key, field.kind]).toEqual([
        field.key,
        kindOf(shape[field.key as keyof typeof shape]),
      ]);
  },
);

it('ajout et retrait dans une liste imbriquée : une liste absente est créée en dernier, les autres lignes ne bougent pas', () => {
  const bake = { id: 'bake', inputs: [{ goodId: 'wheat' }], z: 2 };
  const next = form.updateLines([bake, { id: 'gather' }], 1, 'inputs', addRow);
  expect(next).toEqual([bake, { id: 'gather', inputs: [{}] }]);
  const emptied = form.updateLines(next, 0, 'inputs', (lines) => removeRow(lines, 0));
  expect(JSON.stringify(emptied[0])).toBe(JSON.stringify({ id: 'bake', inputs: [], z: 2 }));
  expect(emptied[1]).toBe(next[1]);
});
