import { describe, expect, it } from 'vitest';
import { chatOpenDirectInputSchema, directChannelOpenedSchema } from './chat';
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
