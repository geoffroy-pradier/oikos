import { expect, it } from 'vitest';
import { uniqueViolation } from './index';

it('reconnaît une violation d’unicité et rend le nom de la contrainte', () => {
  expect(uniqueViolation({ code: '23505', constraint: 'houses_name_unique' })).toBe(
    'houses_name_unique',
  );
});

it('ignore les autres erreurs', () => {
  expect(uniqueViolation({ code: '23514', constraint: 'houses_name_check' })).toBeNull();
  expect(uniqueViolation(new Error('boom'))).toBeNull();
  expect(uniqueViolation(null)).toBeNull();
});
