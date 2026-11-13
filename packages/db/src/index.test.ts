import { expect, it } from 'vitest';
import { violatedConstraint } from './index';

it('rend le nom de la contrainte pour une violation d’unicité ou de vérification', () => {
  expect(violatedConstraint({ code: '23505', constraint: 'houses_name_unique' })).toBe(
    'houses_name_unique',
  );
  expect(violatedConstraint({ code: '23514', constraint: 'houses_name_check' })).toBe(
    'houses_name_check',
  );
});

it('ignore les autres erreurs', () => {
  expect(violatedConstraint({ code: '23503', constraint: 'houses_user_id_fkey' })).toBeNull();
  expect(violatedConstraint({ code: '23505' })).toBeNull();
  expect(violatedConstraint(new Error('boom'))).toBeNull();
  expect(violatedConstraint(null)).toBeNull();
});
