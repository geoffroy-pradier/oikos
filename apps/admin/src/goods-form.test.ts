import { GOOD_TIERS as SCHEMA_TIERS, goodSchema } from '@oikos/config/schema';
import fc from 'fast-check';
import { expect, it } from 'vitest';
import * as form from './goods-form';

const { composeGoods, editGood, GOOD_FIELDS, readGoods, shown, typed } = form;
type Kind = form.GoodField['kind'];

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
  expect(composeGoods(config, editGood(config.goods, 0, GOOD_FIELDS[0], ''))).toBe(
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
      const after = composeGoods(config, editGood(config.goods, row, field, text));
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
