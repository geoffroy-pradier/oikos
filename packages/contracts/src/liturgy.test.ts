import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { LITURGY_GENRES, liturgyAssignedSchema } from './liturgy';

describe('liturgies (#719)', () => {
  it('LiturgyAssigned se relit tel qu’il est écrit, par son schéma comme par l’union', () => {
    const assigned = {
      type: 'LiturgyAssigned' as const,
      payload: {
        liturgyId: '01900000-0000-7000-8000-0000000719a0',
        houseId: '01900000-0000-7000-8000-0000000719a1',
        cityId: '01900000-0000-7000-8000-0000000719c1',
        season: 2_966,
        genre: 'trierarchy' as const,
        due: 6_000,
        dueDay: 20_776,
        dueAt: '2026-11-26T03:00:00.000Z',
      },
    };
    const written = JSON.parse(JSON.stringify(assigned)) as unknown;
    expect(liturgyAssignedSchema.parse(written)).toEqual(assigned);
    expect(domainEventSchema.parse(written)).toEqual(assigned);
    const bad = (patch: Record<string, unknown>) =>
      domainEventSchema.safeParse({ ...assigned, payload: { ...assigned.payload, ...patch } })
        .success;
    expect(bad({ due: 0 })).toBe(false);
    expect(bad({ due: 1.5 })).toBe(false);
    expect(bad({ due: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(bad({ genre: 'banquet' })).toBe(false);
    expect(bad({ wealth: 1 })).toBe(false);
  });

  it('les genres sont une liste fermée de codes de la base', () => {
    expect(LITURGY_GENRES).toEqual(['festival', 'trierarchy', 'choregia']);
  });
});
