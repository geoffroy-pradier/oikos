import { expect, it } from 'vitest';
import { canonicalJson } from './registry';

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
