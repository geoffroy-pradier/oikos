import { describe, expect, it } from 'vitest';
import { domainEventSchema } from './events';
import {
  APPEAL_BODY_MAX_CHARS,
  chatReportInputSchema,
  messageReportedSchema,
  moderationAppealInputSchema,
  sanctionAppealedSchema,
} from './moderation';

const ID = '01900000-0000-7000-8000-000000000e75';

describe('chat.report', () => {
  it('un message et un motif de la forme des identifiants de configuration, rien d’autre', () => {
    expect(chatReportInputSchema.safeParse({ messageId: ID, reason: 'spam' }).success).toBe(true);
    for (const reason of ['Spam', 's', 'spam!', '', 42])
      expect([reason, chatReportInputSchema.safeParse({ messageId: ID, reason }).success]).toEqual([
        reason,
        false,
      ]);
    expect(chatReportInputSchema.safeParse({ messageId: 'x', reason: 'spam' }).success).toBe(false);
    expect(
      chatReportInputSchema.safeParse({ messageId: ID, reason: 'spam', houseId: ID }).success,
    ).toBe(false);
  });

  it('MessageReported se relit par l’union, et ne porte jamais le texte', () => {
    const reported = {
      type: 'MessageReported' as const,
      payload: { reportId: ID, messageId: ID, houseId: ID, reason: 'spam' },
    };
    expect(domainEventSchema.parse(JSON.parse(JSON.stringify(reported)))).toEqual(reported);
    const withBody = { ...reported, payload: { ...reported.payload, body: 'x' } };
    expect(messageReportedSchema.safeParse(withBody).success).toBe(false);
  });
});

describe('moderation.appeal', () => {
  const parse = (body: unknown) => moderationAppealInputSchema.safeParse({ sanctionId: ID, body });

  it('un texte débarrassé de ses blancs de bord, non vide, sans caractère de contrôle', () => {
    expect(parse('  Je conteste.\n ').data).toEqual({ sanctionId: ID, body: 'Je conteste.' });
    for (const body of ['', '  ', 'a\u0000b', 'a\rb', null])
      expect([body, parse(body).success]).toEqual([body, false]);
    expect(
      moderationAppealInputSchema.safeParse({ sanctionId: ID, body: 'x', userId: ID }).success,
    ).toBe(false);
  });

  it('plafond technique compté en caractères', () => {
    expect(parse('🦉'.repeat(APPEAL_BODY_MAX_CHARS)).success).toBe(true);
    expect(parse('a'.repeat(APPEAL_BODY_MAX_CHARS + 1)).success).toBe(false);
  });

  it('SanctionAppealed se relit par l’union, sans le texte de l’appel', () => {
    const appealed = { type: 'SanctionAppealed' as const, payload: { sanctionId: ID } };
    expect(domainEventSchema.parse(JSON.parse(JSON.stringify(appealed)))).toEqual(appealed);
    expect(
      sanctionAppealedSchema.safeParse({ ...appealed, payload: { sanctionId: ID, body: 'x' } })
        .success,
    ).toBe(false);
  });
});
