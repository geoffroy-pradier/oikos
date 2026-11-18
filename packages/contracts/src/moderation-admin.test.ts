import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { adminSanctionInputSchema, MODERATION_ROLES } from './moderation-admin';

const ID = '01900000-0000-7000-8000-000000000e76';

describe('admin.sanction', () => {
  const silence = { userId: ID, kind: 'silence', hours: 24, reason: '  Insultes ' };

  it('une durée pour un avertissement, un silence ou une suspension ; aucune pour une exclusion', () => {
    expect(adminSanctionInputSchema.parse(silence)).toEqual({ ...silence, reason: 'Insultes' });
    expect(
      adminSanctionInputSchema.safeParse({ userId: ID, kind: 'ban', reason: 'x' }).success,
    ).toBe(true);
    for (const wrong of [
      { ...silence, kind: 'ban' },
      { userId: ID, kind: 'silence', reason: 'x' },
      { ...silence, hours: 0 },
      { ...silence, hours: 1.5 },
      { ...silence, kind: 'mute' },
      { ...silence, reason: ' \n ' },
      { ...silence, reason: 'a\u0007' },
      { ...silence, reason: 'é'.repeat(2_001) },
      { ...silence, startsAt: '2026-01-01T00:00:00Z' },
    ])
      expect([wrong, adminSanctionInputSchema.safeParse(wrong).success]).toEqual([wrong, false]);
  });

  it('ouverte aux seuls rôles de la modération', () => {
    expect([...MODERATION_ROLES].sort()).toEqual(['community_manager', 'moderator', 'super_admin']);
  });
});

describe('événements de la modération', () => {
  it('se relisent par l’union, sans motif ni texte', () => {
    const events = [
      {
        type: 'SanctionPronounced',
        payload: { sanctionId: ID, userId: ID, kind: 'ban', pending: true },
      },
      { type: 'ExclusionConfirmed', payload: { sanctionId: ID, userId: ID } },
      { type: 'MessageHidden', payload: { messageId: ID } },
      { type: 'ReportsResolved', payload: { reportIds: [ID], decision: 'upheld' } },
      { type: 'AppealDecided', payload: { sanctionId: ID, decision: 'granted', lifted: true } },
    ];
    for (const event of events) expect(domainEventSchema.parse(event)).toEqual(event);
    expect(
      domainEventSchema.safeParse({
        type: 'SanctionPronounced',
        payload: { sanctionId: ID, userId: ID, kind: 'ban', pending: true, reason: 'x' },
      }).success,
    ).toBe(false);
  });
});
