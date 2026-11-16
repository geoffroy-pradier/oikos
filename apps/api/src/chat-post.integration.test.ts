import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  codeOf,
  db,
  newWorld,
  openDirect,
  owner,
  rows,
  send,
  type SendOptions,
} from './chat-test-world';
import { TEST_CONFIG } from './test-config';

// Messages (6.6), contre Supabase local.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const MAX_LENGTH = TEST_CONFIG.config.chat.maxMessageLength;
const post = (user: string, channelId: string, body: string, options?: SendOptions) =>
  send(user, 'chat.post', { channelId, body }, options);

describe('chat.post', () => {
  it('une maison métèque et une maison citoyenne écrivent dans le canal de leur cité, et dans leurs conversations', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player(undefined, true)];
    const first = await post(alice.user, world.kallisteChannel, '  Khaire, Kallistè !\n');
    expect(first.body).toMatchObject({ ok: true, data: { channelId: world.kallisteChannel } });
    expect((await post(bob.user, world.kallisteChannel, 'Bienvenue.')).status).toBe(200);
    const direct = (await openDirect(alice.user, bob.houseId)).body.data.channelId as string;
    expect((await post(bob.user, direct, 'En privé.')).status).toBe(200);
    const messageId = first.body.data.messageId as string;
    expect(
      await rows(sql`select channel_id, house_id, body,
          abs(extract(epoch from created_at - ${first.body.data.postedAt}::timestamptz)) < 0.001 as dated
        from game.messages where id = ${messageId}`),
    ).toEqual([
      {
        channel_id: world.kallisteChannel,
        house_id: alice.houseId,
        body: 'Khaire, Kallistè !',
        dated: true,
      },
    ]);
    expect(
      await rows(
        sql`select payload from game.domain_events where type = 'MessagePosted' and payload->>'messageId' = ${messageId}`,
      ),
    ).toEqual([
      { payload: { messageId, channelId: world.kallisteChannel, houseId: alice.houseId } },
    ]);
  });

  it('refuse le canal d’une autre cité, la conversation d’autres maisons et un canal inconnu, sans rien écrire', async () => {
    const [world, elsewhere] = [await newWorld(), await newWorld()];
    const [alice, bob, chloe] = [
      await world.player(),
      await world.player(undefined, true),
      await world.player(world.elaia, true),
    ];
    const direct = (await openDirect(alice.user, bob.houseId)).body.data.channelId as string;
    for (const channelId of [
      world.kallisteChannel,
      direct,
      elsewhere.kallisteChannel,
      randomUUID(),
    ])
      expect([channelId, codeOf(await post(chloe.user, channelId, 'Intrus'))]).toEqual([
        channelId,
        [404, 'CHANNEL_NOT_FOUND'],
      ]);
    expect(codeOf(await post(alice.user, world.elaiaChannel, 'Intrus'))).toEqual([
      404,
      'CHANNEL_NOT_FOUND',
    ]);
    expect(codeOf(await post(randomUUID(), world.kallisteChannel, 'Sans maison'))).toEqual([
      404,
      'HOUSE_NOT_FOUND',
    ]);
    expect(
      await rows(
        sql`select id from game.messages where house_id in (${alice.houseId}, ${chloe.houseId})`,
      ),
    ).toEqual([]);
  });

  it('longueur de la configuration, comptée en caractères ; texte vide refusé', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const owls = await post(alice.user, world.kallisteChannel, '🦉'.repeat(MAX_LENGTH));
    expect(owls.status).toBe(200);
    expect(
      codeOf(await post(alice.user, world.kallisteChannel, 'a'.repeat(MAX_LENGTH + 1))),
    ).toEqual([409, 'MESSAGE_TOO_LONG']);
    expect(codeOf(await post(alice.user, world.kallisteChannel, ' \n '))).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
  });

  it('le journal des commandes ne garde pas le texte ; une clé rejouée rend la même réponse, pas pour un autre texte', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const key = randomUUID();
    const text = `Secret ${randomUUID()}`;
    const first = await post(alice.user, world.kallisteChannel, text, { key });
    expect(first.status).toBe(200);
    expect(await post(alice.user, world.kallisteChannel, text, { key })).toMatchObject({
      replayed: 'true',
      body: first.body,
    });
    expect(codeOf(await post(alice.user, world.kallisteChannel, `${text}!`, { key }))).toEqual([
      409,
      'IDEMPOTENCY_KEY_REUSED',
    ]);
    expect(
      await rows(
        sql`select input from game.command_log where user_id = ${alice.user} and command = 'chat.post'`,
      ),
    ).toEqual([{ input: expect.objectContaining({ redacted: true }) }]);
    expect(
      await rows(
        sql`select 1 from game.command_log where user_id = ${alice.user} and (input::text || response::text) like ${`%${text}%`}`,
      ),
    ).toEqual([]);
    expect(
      await rows(sql`select 1 from game.domain_events where payload::text like ${`%${text}%`}`),
    ).toEqual([]);
    expect(
      await rows(sql`select count(*)::int as n from game.messages where body = ${text}`),
    ).toEqual([{ n: 1 }]);
  });

  it('un compte qui a une maison dans deux mondes écrit depuis celle du monde du canal', async () => {
    const [first, second] = [await newWorld(), await newWorld()];
    const alice = await first.player();
    const aliceThere = await second.player(second.elaia, false, alice.user);
    for (const [channelId, houseId] of [
      [first.kallisteChannel, alice.houseId],
      [second.elaiaChannel, aliceThere.houseId],
    ] as const) {
      const posted = await post(alice.user, channelId, 'Deux mondes');
      expect(posted.status).toBe(200);
      expect(
        await rows(
          sql`select house_id from game.messages where id = ${posted.body.data.messageId as string}`,
        ),
      ).toEqual([{ house_id: houseId }]);
    }
    expect(codeOf(await post(alice.user, second.kallisteChannel, 'Pas ma cité là-bas'))).toEqual([
      404,
      'CHANNEL_NOT_FOUND',
    ]);
  });
});
