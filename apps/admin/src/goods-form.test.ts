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
  ['integer', ' 12 ', 12],
  // Composé sans contrôle : un prix à virgule part tel quel, l'API le refuse (entier attendu).
  ['integer', '1.5', 1.5],
  ['decimal', '0,45', 0.45],
  ['decimal', '1.', 1],
  // Jamais de valeur devinée : ce qui ne se lit pas comme un nombre reste un texte.
  ['integer', '1,000', '1,000'],
  ['integer', '1 200', '1 200'],
  ['integer', '0x10', '0x10'],
  ['integer', ' ', ' '],
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

it('une valeur d’un autre type que celui du champ est montrée en JSON, une valeur absente est vide', () => {
  const all = (kind: Kind, ...values: unknown[]) => values.map((value) => shown(kind, value));
  expect(all('integer', 12, -0.5, '12', null)).toEqual(['12', '-0.5', '"12"', 'null']);
  expect(all('text', 'wheat', 7, undefined)).toEqual(['wheat', '7', '']);
});

it('tout nombre affiché se relit tel quel ; un entier que JSON ne porte pas exactement reste un texte', () => {
  const number = fc.oneof(fc.maxSafeInteger(), fc.double({ noNaN: true, noDefaultInfinity: true }));
  fc.assert(
    fc.property(number, fc.constantFrom<Kind>('integer', 'decimal'), (value, kind) => {
      fc.pre(!Object.is(value, -0));
      const exact = !Number.isInteger(value) || Number.isSafeInteger(value);
      expect(typed(kind, shown(kind, value))).toBe(exact ? value : String(value));
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
      expect(JSON.parse(after)).toEqual(JSON.parse(JSON.stringify(expected)));
      expect(Object.keys(JSON.parse(after) as object)).toEqual(Object.keys(config));
      // Rien n'est modifié en place, et relire puis recomposer rend le même texte.
      expect(JSON.stringify(config)).toBe(before);
      expect(composeGoods(JSON.parse(after), readGoods(JSON.parse(after)) ?? [])).toBe(after);
    }),
  );
});
