import { gameConfigSchema } from '@oikos/config/schema';
import { expect, it } from 'vitest';
import en from './locales/en.json';
import fr from './locales/fr.json';
import { labelSchemaTarget, parseSchemaError } from './schema-errors';

const CONFIG = {
  market: { npcMaxPriceFactor: 3 },
  goods: [{ id: 'wheat', elasticity: 9 }, { id: '  ' }, { id: 7 }, 'bread'],
  recipes: [{ id: 'bake_bread', outputs: [{ goodId: 'bread', quantity: 1 }, { quantity: 2 }] }],
  cities: [{ id: 'athens', population: JSON.parse('{"workers":-1,"__proto__":2}') as unknown }],
};
const label = (error: string, language: 'fr' | 'en' = 'fr', config: unknown = CONFIG) =>
  labelSchemaTarget(parseSchemaError(error, config).target, language);

it('sépare chemin et diagnostic au premier « : » ; table, ligne par identifiant, champ', () => {
  expect(parseSchemaError('goods[0].elasticity: Too big: expected <=5', CONFIG)).toEqual({
    path: 'goods[0].elasticity',
    detail: 'Too big: expected <=5',
    target: { table: 'goods', row: { index: 0, id: 'wheat' }, field: ['elasticity'] },
  });
  const nested = parseSchemaError('recipes[0].outputs[0].goodId: unknown good', CONFIG).target;
  expect(nested?.row).toEqual({ index: 0, id: 'bake_bread' });
  expect(nested?.field).toEqual(['outputs', { index: 0, id: 'bread' }, 'goodId']);
  const root = parseSchemaError('(root): Unrecognized key: "x"', CONFIG);
  expect(root).toMatchObject({ path: '(root)', target: { table: null, row: null, field: [] } });
  expect(parseSchemaError('market.npcMaxPriceFactor', CONFIG).detail).toBe('');
});

it.each<[string, string[] | null]>([
  ['goods[0].elasticity: Too big', ['Biens', 'wheat', 'élasticité']],
  // Listes imbriquées : la ligne est désignée par son `goodId`, sinon par sa position.
  ['recipes[0].outputs[0].goodId: x', ['Recettes', 'bake_bread', 'extrants', 'bread', 'bien']],
  [
    'recipes[0].outputs[1].quantity',
    ['Recettes', 'bake_bread', 'extrants', 'élément 2', 'quantité'],
  ],
  ['(root): Unrecognized key: "x"', ['Configuration entière']],
  ['goods: duplicate id "wheat"', ['Biens']],
  // Champ sans libellé (seules les tables courantes en ont) : sa clé, sous le nom de sa table.
  ['market.npcMaxPriceFactor', ['Marché', 'npcMaxPriceFactor']],
  // Identifiant illisible : rang hors limite, identifiant blanc, pas un texte, ligne qui n'est pas un objet.
  ['goods[99].elasticity', ['Biens', 'élément 100', 'élasticité']],
  ['goods[1].tier', ['Biens', 'élément 2', 'niveau']],
  ['goods[2].id', ['Biens', 'élément 3', 'identifiant']],
  ['goods[3]', ['Biens', 'élément 4']],
  // Clés de données : une classe nommée comme un champ de recette n'est pas traduite, une propriété
  // héritée n'est ni une table ni un libellé.
  ['goods[0].workers', ['Biens', 'wheat', 'workers']],
  ['cities[0].population.workers', ['Cités', 'athens', 'population', 'workers']],
  ['cities[0].population.__proto__', ['Cités', 'athens', 'population', '__proto__']],
  ['goods[0].constructor[0].id', ['Biens', 'wheat', 'constructor', 'élément 1', 'identifiant']],
  ['constructor.name: x', null],
  ['__proto__[0].id: x', null],
  ['weather.rain: wet', null],
])('%s', (error, expected) => {
  expect(label(error)).toEqual(expected);
});

it('configuration inconnue ou autrement faite : position, comptée à partir de 1', () => {
  for (const config of [null, 'texte', [], { goods: { 0: { id: 'wheat' } } }, { goods: null }]) {
    expect(label('goods[0].elasticity', 'fr', config)).toEqual([
      'Biens',
      'élément 1',
      'élasticité',
    ]);
  }
});

it('un chemin mal formé est rendu tel quel, sans rien perdre', () => {
  const malformed = [
    '',
    '[0].id',
    'goods..id',
    'goods.',
    '.goods',
    'goods[x]',
    'goods[1',
    'goods]',
  ];
  for (const path of [...malformed, 'goods[1e3]', 'goods[-1]', `goods[${'9'.repeat(30)}].id`]) {
    const parsed = parseSchemaError(`${path}: detail: more`, CONFIG);
    expect(parsed).toEqual({ path, detail: 'detail: more', target: null });
    expect(labelSchemaTarget(parsed.target, 'fr')).toBeNull();
  }
});

it('langue : libellés anglais, mêmes identifiants', () => {
  expect(label('goods[0].elasticity', 'en')).toEqual(['Goods', 'wheat', 'elasticity']);
  expect(label('goods[99].tier', 'en')).toEqual(['Goods', 'item 100', 'tier']);
  expect(label('(root)', 'en')).toEqual(['Whole configuration']);
});

/** Clés d'objet d'un schéma, listes traversées. Les clés d'un `record` sont des données, pas des champs. */
function fieldNames(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  if ('element' in schema) return fieldNames(schema.element);
  const shape = 'shape' in schema ? (schema.shape as object) : {};
  return Object.entries(shape).flatMap(([key, value]) => [key, ...fieldNames(value)]);
}

it('les libellés suivent le schéma : toutes ses tables, tous les champs des tables courantes', () => {
  const shape: Record<string, unknown> = gameConfigSchema.shape;
  for (const labels of [fr.config.schemaPath, en.config.schemaPath]) {
    expect(Object.keys(labels.tables).sort()).toEqual(Object.keys(shape).sort());
    const tables: Record<string, object> = labels.fields;
    expect(Object.keys(tables)).toEqual(expect.arrayContaining(['goods', 'recipes', 'npcClasses']));
    for (const [table, fields] of Object.entries(tables)) {
      expect(Object.keys(fields).length).toBeGreaterThan(0);
      expect(Object.keys(fields).sort()).toEqual([...new Set(fieldNames(shape[table]))].sort());
    }
  }
});
