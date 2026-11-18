import { expect, it } from 'vitest';
import { transactionConflict, violatedConstraint } from './index';

it('rend le nom de la contrainte pour une violation de clé étrangère, d’unicité ou de vérification', () => {
  expect(violatedConstraint({ code: '23503', constraint: 'reports_message_id_fkey' })).toBe(
    'reports_message_id_fkey',
  );
  expect(violatedConstraint({ code: '23505', constraint: 'houses_name_unique' })).toBe(
    'houses_name_unique',
  );
  expect(violatedConstraint({ code: '23514', constraint: 'houses_name_check' })).toBe(
    'houses_name_check',
  );
});

it('ignore les autres erreurs', () => {
  expect(violatedConstraint({ code: '23502', constraint: 'houses_user_id_not_null' })).toBeNull();
  expect(violatedConstraint({ code: '23505' })).toBeNull();
  expect(violatedConstraint(new Error('boom'))).toBeNull();
  expect(violatedConstraint(null)).toBeNull();
});

it('reconnaît un interblocage ou un échec de sérialisation, et rien d’autre', () => {
  expect(transactionConflict({ code: '40P01' })).toBe('40P01');
  expect(transactionConflict({ code: '40001' })).toBe('40001');
  // Verrou non obtenu à temps, annulation, connexion perdue : la transaction n'est pas rejouée.
  for (const other of [
    { code: '55P03' },
    { code: '57014' },
    { code: '08006' },
    new Error('boom'),
    null,
  ])
    expect(transactionConflict(other)).toBeNull();
});
