import { honorSchema, liturgiesSchema } from '@oikos/config';
import { HONOR_REASONS } from '@oikos/contracts';
import { expect, it } from 'vitest';

/** Motifs dont la variation est réglée hors de `honor.changes` : par la section `liturgies` (#719, #720). */
const ELSEWHERE = { liturgy_performed: 'honorGain', liturgy_evaded: 'evasionHonorLoss' } as const;

it('chaque motif de la Timè a sa variation dans la configuration, et aucune autre (#704)', () => {
  expect(
    [...Object.keys(honorSchema.shape.changes.shape), ...Object.keys(ELSEWHERE)].sort(),
  ).toEqual([...HONOR_REASONS].sort());
  for (const field of Object.values(ELSEWHERE))
    expect(Object.keys(liturgiesSchema.shape)).toContain(field);
});
