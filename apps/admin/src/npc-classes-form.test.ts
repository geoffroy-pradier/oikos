import { NEED_LEVELS as SCHEMA_NEEDS, npcClassSchema } from '@oikos/config/schema';
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { composeTable, editNested, editRow, typed } from './goods-form';
import * as form from './npc-classes-form';

const { BASKET_FIELDS, NPC_CLASS_FIELDS, readNpcClasses } = form;
type Classes = { npcClasses: Record<string, Record<string, unknown>[]>[] };

it('les champs, le panier et les besoins du formulaire sont ceux du schéma, dans son ordre', () => {
  expect([...NPC_CLASS_FIELDS.map((field) => field.key), 'basket']).toEqual(
    Object.keys(npcClassSchema.shape),
  );
  expect(BASKET_FIELDS.map((field) => field.key)).toEqual(
    Object.keys(npcClassSchema.shape.basket.element.shape),
  );
  expect(form.NEED_LEVELS).toEqual([...SCHEMA_NEEDS]);
});

it('sans liste de classes lisible, ou avec un panier illisible, pas de formulaire', () => {
  for (const basket of [{}, [1], null, [[]]])
    expect(readNpcClasses({ npcClasses: [{ id: 'a' }, { basket }] })).toBeNull();
  for (const config of [null, [], { npcClasses: {} }, { npcClasses: ['a'] }])
    expect(readNpcClasses(config)).toBeNull();
  // Sans liste : rien à montrer. Un panier absent est vide, pas illisible.
  expect(readNpcClasses({ goods: [] })).toEqual([]);
  expect(readNpcClasses({ npcClasses: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
});

it('conservation : une saisie dans une classe ou dans son panier ne change que sa valeur, ordre des clés compris', () => {
  const json = fc.jsonValue();
  const basket = fc.array(fc.dictionary(fc.string(), json), { minLength: 1 });
  const npcClass = fc.record({ id: json, basket, extra: json });
  // Une classe sans panier : clés quelconques, sauf `basket` (sans quoi elle pourrait être illisible).
  const key = fc.string().filter((name) => name !== 'basket');
  const source = fc.record({
    npcClasses: fc.array(fc.oneof(npcClass, fc.dictionary(key, json)), { minLength: 1 }),
    rest: fc.dictionary(fc.string(), json),
  });
  const input = fc.oneof(fc.string(), fc.double().map(String), fc.maxSafeInteger().map(String));
  // Une saisie vise un champ de la classe, ou un champ d'une ligne de son panier.
  const target = fc.oneof(
    fc.record({ field: fc.constantFrom(...NPC_CLASS_FIELDS) }),
    fc.record({ field: fc.constantFrom(...BASKET_FIELDS), inBasket: fc.constant(true) }),
  );
  fc.assert(
    fc.property(source, fc.nat(), fc.nat(), target, input, (data, pickRow, pickLine, aim, text) => {
      // Comme à l'écran : la configuration est lue d'un texte JSON.
      const before = JSON.stringify({ ...data.rest, npcClasses: data.npcClasses });
      const config = JSON.parse(before) as Classes;
      const row = pickRow % config.npcClasses.length;
      const expected = JSON.parse(before) as Classes;
      const entry = expected.npcClasses[row] ?? {};
      const lines = 'inBasket' in aim ? entry['basket'] : undefined;
      fc.pre(!('inBasket' in aim) || (Array.isArray(lines) && lines.length > 0));
      const line = pickLine % (lines?.length ?? 1);
      const next =
        'inBasket' in aim
          ? editNested(config.npcClasses, row, 'basket', line, aim.field, text)
          : editRow(config.npcClasses, row, aim.field, text);
      // Valeur attendue écrite à la main, à sa place : seule cette clé change, ou disparaît si vidée.
      const changed = (lines?.[line] ?? entry) as Record<string, unknown>;
      const value = typed(aim.field.kind, text);
      if (value === undefined) Reflect.deleteProperty(changed, aim.field.key);
      else changed[aim.field.key] = value;
      expect(composeTable(config, 'npcClasses', next)).toBe(JSON.stringify(expected, null, 2));
      // Rien n'est modifié en place, et le texte écrit se relit dans le formulaire.
      expect(JSON.stringify(config)).toBe(before);
      expect(readNpcClasses(JSON.parse(composeTable(config, 'npcClasses', next)))).toEqual(next);
    }),
  );
});
