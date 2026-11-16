import { describe, expect, it } from 'vitest';
import {
  chatOpenDirectInputSchema,
  chatPostInputSchema,
  directChannelOpenedSchema,
  MESSAGE_BODY_MAX_CHARS,
  messagePostedSchema,
} from './chat';
import { domainEventSchema } from './events';

const ID = '01900000-0000-7000-8000-000000000e01';

describe('chat.openDirect', () => {
  it('une maison désignée par son identifiant, rien d’autre', () => {
    expect(chatOpenDirectInputSchema.safeParse({ houseId: ID }).success).toBe(true);
    expect(chatOpenDirectInputSchema.safeParse({ houseId: 'Alcméonides' }).success).toBe(false);
    expect(chatOpenDirectInputSchema.safeParse({ houseId: ID, body: 'x' }).success).toBe(false);
  });

  it('DirectChannelOpened se relit tel qu’il est écrit, par son schéma comme par l’union', () => {
    const opened = {
      type: 'DirectChannelOpened' as const,
      payload: { channelId: ID, houseId: ID, otherHouseId: ID },
    };
    const written = JSON.parse(JSON.stringify(opened)) as unknown;
    expect(directChannelOpenedSchema.parse(written)).toEqual(opened);
    expect(domainEventSchema.parse(written)).toEqual(opened);
  });
});

describe('chat.post', () => {
  const parse = (body: unknown) => chatPostInputSchema.safeParse({ channelId: ID, body });

  it('un texte débarrassé de ses blancs de bord, sauts de ligne et tabulations admis', () => {
    expect(parse('  Khaire !\n\tÀ demain.  ').data).toEqual({
      channelId: ID,
      body: 'Khaire !\n\tÀ demain.',
    });
  });

  it('refuse un texte vide ou blanc, un caractère de contrôle, un champ de trop', () => {
    for (const body of [
      '',
      '   ',
      '\n\t ',
      '\u00a0',
      'a\u0000b',
      'a\u0007b',
      'a\rb',
      'a\u0085b',
      42,
      null,
    ])
      expect([body, parse(body).success]).toEqual([body, false]);
    expect(chatPostInputSchema.safeParse({ channelId: 'x', body: 'Bonjour' }).success).toBe(false);
    expect(
      chatPostInputSchema.safeParse({ channelId: ID, body: 'Bonjour', houseId: ID }).success,
    ).toBe(false);
  });

  it('plafond technique compté en caractères, pas en unités UTF-16 ; les blancs de bord ne comptent pas', () => {
    expect(parse('🦉'.repeat(MESSAGE_BODY_MAX_CHARS)).success).toBe(true);
    expect(parse('a'.repeat(MESSAGE_BODY_MAX_CHARS + 1)).success).toBe(false);
    expect(parse(` ${'a'.repeat(MESSAGE_BODY_MAX_CHARS)} `).success).toBe(true);
  });

  it('MessagePosted se relit par l’union, et ne porte jamais le texte', () => {
    const posted = {
      type: 'MessagePosted' as const,
      payload: { messageId: ID, channelId: ID, houseId: ID },
    };
    expect(domainEventSchema.parse(JSON.parse(JSON.stringify(posted)))).toEqual(posted);
    const withBody = { ...posted, payload: { ...posted.payload, body: 'x' } };
    expect(messagePostedSchema.safeParse(withBody).success).toBe(false);
  });
});
