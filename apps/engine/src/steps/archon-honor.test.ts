import { honorSchema } from '@oikos/config';
import { HONOR_REASONS } from '@oikos/contracts';
import { expect, it } from 'vitest';

it('chaque motif de la Timè a sa variation dans la configuration, et aucune autre (#704)', () => {
  expect(Object.keys(honorSchema.shape.changes.shape).sort()).toEqual([...HONOR_REASONS].sort());
});
