import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { appWith, codeOf, db, newWorld, openDirect, owner, rows, send } from './chat-test-world';
import { TEST_CONFIG } from './test-config';

// Diffusion des messages par Realtime (ADR 0008), contre Supabase local avec Realtime activé : seul un message
// validé est diffusé, une fois, avec ses seuls identifiants.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const RATE = { messages: 3, windowSeconds: 60 };
const limited = appWith(async () => ({
  ...TEST_CONFIG,
  config: { ...TEST_CONFIG.config, chat: { ...TEST_CONFIG.config.chat, rateLimit: RATE } },
}));
const post = (user: string, channelId: string, body: string, key = randomUUID()) =>
  send(user, 'chat.post', { channelId, body }, { key, via: limited });
/** Diffusions d'un canal, lues dans `realtime.messages` par le propriétaire. */
const broadcasts = (channelId: string) =>
  rows(sql<{ topic: string; event: string; private: boolean; payload: Record<string, unknown> }>`
    select topic, event, private, payload from realtime.messages
    where payload->>'channel_id' = ${channelId} order by topic, inserted_at`);

describe('diffusion des messages', () => {
  it('un message validé est diffusé une fois sur le sujet de son canal, sans texte ni auteur ; rejoué, il ne l’est pas de nouveau', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const key = randomUUID();
    const first = await post(alice.user, world.kallisteChannel, 'Texte à taire', key);
    expect(first.status).toBe(200);
    expect((await post(alice.user, world.kallisteChannel, 'Texte à taire', key)).replayed).toBe(
      'true',
    );
    const sent = await broadcasts(world.kallisteChannel);
    expect(sent).toHaveLength(1);
    const [only] = sent;
    expect(only).toMatchObject({
      topic: `chat:${world.kallisteChannel}`,
      event: 'message_posted',
      private: true,
    });
    const { id, ...payload } = only?.payload ?? {};
    expect(typeof id).toBe('string');
    expect(payload).toEqual({
      channel_id: world.kallisteChannel,
      message_id: first.body.data.messageId,
    });
    expect(JSON.stringify(only?.payload)).not.toMatch(/Texte|taire/);
    expect(JSON.stringify(only?.payload)).not.toContain(alice.houseId);
  });

  it('un message privé est diffusé aux deux maisons de la conversation', async () => {
    const world = await newWorld();
    const [alice, chloe] = [await world.player(), await world.player(world.elaia)];
    const direct = (await openDirect(alice.user, chloe.houseId)).body.data.channelId as string;
    expect((await post(chloe.user, direct, 'Entre nous')).status).toBe(200);
    expect((await broadcasts(direct)).map((sent) => sent.topic)).toEqual(
      [`house:${alice.houseId}`, `house:${chloe.houseId}`].sort(),
    );
  });

  it('un message refusé n’est pas diffusé : canal d’une autre cité, trop long, débit dépassé', async () => {
    const world = await newWorld();
    const [alice, chloe] = [await world.player(), await world.player(world.elaia)];
    expect(codeOf(await post(chloe.user, world.kallisteChannel, 'Intrus'))).toEqual([
      404,
      'CHANNEL_NOT_FOUND',
    ]);
    const tooLong = 'a'.repeat(TEST_CONFIG.config.chat.maxMessageLength + 1);
    expect(codeOf(await post(alice.user, world.kallisteChannel, tooLong))).toEqual([
      409,
      'MESSAGE_TOO_LONG',
    ]);
    expect(await broadcasts(world.kallisteChannel)).toEqual([]);
    // Rafale simultanée au-delà du débit : chaque message validé est diffusé une fois, aucun refusé ne l’est.
    const burst = await Promise.all(
      Array.from({ length: RATE.messages + 3 }, (_, n) =>
        post(alice.user, world.kallisteChannel, `Rafale ${n}`),
      ),
    );
    const posted = burst.filter((reply) => reply.status === 200).map((reply) => reply.body);
    expect(posted).toHaveLength(RATE.messages);
    expect(
      (await broadcasts(world.kallisteChannel)).map((sent) => sent.payload['message_id']).sort(),
    ).toEqual(posted.map((body) => body.data.messageId as string).sort());
  });
});
