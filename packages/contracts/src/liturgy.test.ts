import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import {
  LITURGY_GENRES,
  liturgyAssignedSchema,
  liturgyPerformInputSchema,
  liturgyPerformOutputSchema,
} from './liturgy';

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

  it('liturgy.perform : un dû positif, un faste entier, positif ou nul, en entiers sûrs (#720)', () => {
    const input = {
      liturgyId: '01900000-0000-7000-8000-0000000720a0',
      expectedDue: 600,
      splendor: 0,
    };
    expect(liturgyPerformInputSchema.parse(input)).toEqual(input);
    const bad = (patch: Record<string, unknown>) =>
      liturgyPerformInputSchema.safeParse({ ...input, ...patch }).success;
    expect(bad({ splendor: Number.MAX_SAFE_INTEGER })).toBe(true);
    for (const patch of [
      { expectedDue: 0 },
      { splendor: -1 },
      { splendor: 0.5 },
      { splendor: Number.MAX_SAFE_INTEGER + 1 },
      { liturgyId: 'x' },
      { houseId: '01900000-0000-7000-8000-0000000720a1' },
    ])
      expect(bad(patch), JSON.stringify(patch)).toBe(false);
    const output = liturgyPerformOutputSchema.parse({
      liturgyId: input.liturgyId,
      cityId: '01900000-0000-7000-8000-0000000720c1',
      season: 2_966,
      genre: 'choregia',
      due: 600,
      splendor: 0,
      honorGained: 0,
      charisGained: 0,
      godId: null,
    });
    expect(output.godId).toBeNull();
  });

  it('LiturgyPerformed et LiturgyLevied se relisent par l’union (#720)', () => {
    const ids = {
      liturgyId: '01900000-0000-7000-8000-0000000720a0',
      houseId: '01900000-0000-7000-8000-0000000720a1',
      cityId: '01900000-0000-7000-8000-0000000720c1',
    };
    const performed = {
      type: 'LiturgyPerformed' as const,
      payload: { ...ids, season: 3, genre: 'festival' as const, due: 600, splendor: 150 },
    };
    const full = {
      ...performed,
      payload: { ...performed.payload, honorGained: 12, charisGained: 25, godId: 'athena' },
    };
    expect(domainEventSchema.parse(JSON.parse(JSON.stringify(full)))).toEqual(full);
    const levied = {
      type: 'LiturgyLevied' as const,
      payload: { ...ids, season: 3, due: 600, levied: 0, honorLost: 40, gameDay: 20_779 },
    };
    expect(domainEventSchema.parse(JSON.parse(JSON.stringify(levied)))).toEqual(levied);
    expect(
      domainEventSchema.safeParse({ ...levied, payload: { ...levied.payload, levied: -1 } })
        .success,
    ).toBe(false);
    expect(
      domainEventSchema.safeParse({ ...levied, payload: { ...levied.payload, honorLost: -40 } })
        .success,
    ).toBe(false);
  });
});
