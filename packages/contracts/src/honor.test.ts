import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { HONOR_REASONS, honorChangedSchema } from './honor';

describe('Timè (#704)', () => {
  it('HonorChanged se relit tel qu’il est écrit, par son schéma comme par l’union', () => {
    const changed = {
      type: 'HonorChanged' as const,
      payload: {
        houseId: '01900000-0000-7000-8000-0000000000a1',
        amount: -3,
        reason: 'archon_term' as const,
        balance: -10_000,
      },
    };
    const written = JSON.parse(JSON.stringify(changed)) as unknown;
    expect(honorChangedSchema.parse(written)).toEqual(changed);
    expect(domainEventSchema.parse(written)).toEqual(changed);
    const bad = (patch: Record<string, unknown>) =>
      domainEventSchema.safeParse({ ...changed, payload: { ...changed.payload, ...patch } })
        .success;
    expect(bad({ amount: 0 })).toBe(false);
    expect(bad({ amount: 1.5 })).toBe(false);
    expect(bad({ balance: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(bad({ reason: 'moderation' })).toBe(false);
    expect(bad({ reference: changed.payload.houseId })).toBe(false);
  });

  it('les motifs sont une liste fermée de codes de la base', () => {
    expect(HONOR_REASONS).toEqual(['archon_term', 'liturgy_performed', 'liturgy_evaded']);
    for (const reason of HONOR_REASONS) expect(reason).toMatch(/^[a-z][a-z0-9_]{1,31}$/);
  });
});
