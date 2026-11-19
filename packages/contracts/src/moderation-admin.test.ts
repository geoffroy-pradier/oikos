import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import { adminReportsSchema, adminSanctionInputSchema, MODERATION_ROLES } from './moderation-admin';

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
      { type: 'ExclusionWithdrawn', payload: { sanctionId: ID, userId: ID } },
      { type: 'SanctionLiftProposed', payload: { sanctionId: ID, userId: ID } },
      { type: 'SanctionLifted', payload: { sanctionId: ID, userId: ID, kind: 'suspension' } },
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

describe('GET /api/admin/reports', () => {
  const at = '2026-11-18T10:00:00.000Z';
  const message = {
    id: ID,
    houseId: ID,
    houseName: 'Philaïdes',
    body: 'x',
    createdAt: at,
    hiddenAt: null,
  };
  const entry = {
    world: 'archipel',
    reportedHouse: { id: ID, name: 'Philaïdes', userId: ID },
    channel: { id: ID, kind: 'city', city: 'kalliste' },
    message,
    reports: [{ id: ID, reason: 'spam', createdAt: at }],
    context: [message],
  };
  const reports = {
    now: at,
    contextSize: 5,
    staleAfterHours: 24,
    sanctionHours: { warning: [168], silence: [1, 24], suspension: [720] },
    queue: [entry],
    appeals: [],
    pendingExclusions: [],
    pendingLifts: [
      {
        sanctionId: ID,
        userId: ID,
        reason: 'Triche',
        authorId: ID,
        confirmedBy: ID,
        startsAt: at,
        proposedBy: ID,
        proposedAt: at,
      },
    ],
    activeExclusions: [
      { sanctionId: ID, userId: ID, reason: 'Triche', authorId: ID, confirmedBy: ID, startsAt: at },
    ],
  };

  it('se lit sans aucun champ de plus : ni donnée économique, ni maison qui signale', () => {
    expect(adminReportsSchema.parse(reports)).toEqual(reports);
    const unread = { ...reports, sanctionHours: null };
    expect(adminReportsSchema.parse(unread)).toEqual(unread);
    const hours = reports.sanctionHours;
    for (const wrong of [
      // Des durées, rien d'autre de la configuration ; chaque sorte en a au moins une, entière et positive.
      { ...reports, sanctionHours: { ...hours, bannedTerms: [] } },
      { ...reports, sanctionHours: { ...hours, silence: [] } },
      { ...reports, sanctionHours: { ...hours, silence: [1.5] } },
      { ...reports, sanctionHours: { ...hours, silence: [0] } },
      { ...reports, sanctionHours: { warning: [168], silence: [1] } },
      { ...reports, sanctionHours: undefined },
      { ...reports, queue: [{ ...entry, reportedHouse: { ...entry.reportedHouse, balance: 10 } }] },
      { ...reports, queue: [{ ...entry, reports: [{ ...entry.reports[0], houseId: ID }] }] },
      { ...reports, queue: [{ ...entry, reports: [] }] },
      { ...reports, economy: {} },
      // Une levée proposée ne dit rien de plus que les comptes, le motif et les instants (#616).
      { ...reports, pendingLifts: [{ ...reports.pendingLifts[0], balance: 10 }] },
      { ...reports, pendingLifts: [{ ...reports.pendingLifts[0], proposedBy: null }] },
      { ...reports, activeExclusions: [{ ...reports.activeExclusions[0], balance: 10 }] },
      { ...reports, activeExclusions: [{ ...reports.activeExclusions[0], confirmedBy: null }] },
    ])
      expect(adminReportsSchema.safeParse(wrong).success).toBe(false);
  });
});
