import { honorSchema, liturgiesSchema, templeTreasurySchema } from '@oikos/config';
import { HONOR_REASONS } from '@oikos/contracts';
import { expect, it } from 'vitest';

/**
 * Motifs dont la variation est réglée hors de `honor.changes` : par la section `liturgies` (#719, #720) ou par la
 * section `templeTreasury` (#725).
 */
const ELSEWHERE = {
  liturgy_performed: [liturgiesSchema, 'honorGain'],
  liturgy_evaded: [liturgiesSchema, 'evasionHonorLoss'],
  loan_defaulted: [templeTreasurySchema, 'defaultHonorLoss'],
} as const;

it('chaque motif de la Timè a sa variation dans la configuration, et aucune autre (#704)', () => {
  expect(
    [...Object.keys(honorSchema.shape.changes.shape), ...Object.keys(ELSEWHERE)].sort(),
  ).toEqual([...HONOR_REASONS].sort());
  for (const [schema, field] of Object.values(ELSEWHERE))
    expect(Object.keys(schema.shape)).toContain(field);
});
