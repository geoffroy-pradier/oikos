import { expect, it } from 'vitest';
import { canonicalJson, storableInput, storableJson } from './registry';

it('ne dépend pas de l’ordre des clés, à tous les niveaux', () => {
  const a = { name: 'Abc', blazon: { shape: 'hoplon', emblem: 'owl' }, tags: [{ y: 1, x: 2 }] };
  const b = { tags: [{ x: 2, y: 1 }], blazon: { emblem: 'owl', shape: 'hoplon' }, name: 'Abc' };
  expect(canonicalJson(a)).toBe(canonicalJson(b));
});

it('distingue des valeurs différentes, l’ordre des tableaux et les types', () => {
  expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: '1' }));
  expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  expect(canonicalJson(null)).toBe('null');
  expect(canonicalJson(undefined)).toBe('null');
});

it('storableJson refuse ce que Postgres ne peut pas stocker en jsonb', () => {
  expect(storableJson({ name: 'Alcméonides', n: 1 })).toBe('{"name":"Alcméonides","n":1}');
  expect(storableJson(undefined)).toBe('null');
  // Une paire de substitution complète (émoji) est valide.
  expect(storableJson({ name: 'a\u{1F3DB}b' })).not.toBeNull();
  expect(storableJson({ name: 'ab\u0000cd' })).toBeNull();
  expect(storableJson({ 'x\u0000': 1 })).toBeNull();
  expect(storableJson('\ud800')).toBeNull();
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  expect(storableJson(cyclic)).toBeNull();
});

it('storableInput rend le texte et la forme canonique, ou null plutôt que de lever', () => {
  expect(storableInput({ b: 1, a: [2] })).toEqual({
    text: '{"b":1,"a":[2]}',
    canonical: '{"a":[2],"b":1}',
  });
  // La profondeur où la forme canonique dépasse la pile dépend de Node : jamais d'exception, à aucune.
  for (const depth of [3_500, 6_000, 100_000]) {
    const deep = JSON.parse(`${'['.repeat(depth)}${']'.repeat(depth)}`) as unknown;
    expect(() => storableInput(deep)).not.toThrow();
  }
  const deepest = JSON.parse(`${'['.repeat(100_000)}${']'.repeat(100_000)}`) as unknown;
  expect([storableInput(deepest), storableJson(deepest)]).toEqual([null, null]);
});
