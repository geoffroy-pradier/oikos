import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  appWith,
  codeOf,
  db,
  newWorld,
  openDirect,
  owner,
  rows,
  send,
  type SendOptions,
} from './chat-test-world';
import type { Telemetry } from './telemetry';
import { newAccount, TEST_CONFIG } from './test-config';

// Messages (6.6), contre Supabase local.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const MAX_LENGTH = TEST_CONFIG.config.chat.maxMessageLength;
/** Débit resserré : 3 messages par minute. */
const RATE = { messages: 3, windowSeconds: 60 };
const limitedConfig = async () => ({
  ...TEST_CONFIG,
  config: { ...TEST_CONFIG.config, chat: { ...TEST_CONFIG.config.chat, rateLimit: RATE } },
});
const limited = appWith(limitedConfig);
const countOf = async (houseId: string) =>
  rows(sql`select count(*)::int as n from game.messages where house_id = ${houseId}`);
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
    expect(
      codeOf(await post(await newAccount(owner), world.kallisteChannel, 'Sans maison')),
    ).toEqual([404, 'HOUSE_NOT_FOUND']);
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

  it('même entrée, clés dans un autre ordre, même clé : la même réponse, rejouée', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const key = randomUUID();
    const [channelId, body] = [world.kallisteChannel, 'Ordre des clés'];
    const first = await send(alice.user, 'chat.post', { channelId, body }, { key });
    expect(first.status).toBe(200);
    expect(await send(alice.user, 'chat.post', { body, channelId }, { key })).toMatchObject({
      replayed: 'true',
      body: first.body,
    });
    expect(
      await rows(sql`select count(*)::int as n from game.messages where body = ${body}
      and house_id = ${alice.houseId}`),
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

  it('débit dépassé, tous canaux confondus, pour cette maison seulement', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    const direct = (await openDirect(alice.user, bob.houseId)).body.data.channelId as string;
    for (const channelId of [world.kallisteChannel, direct, world.kallisteChannel])
      expect((await post(alice.user, channelId, 'Encore', { via: limited })).status).toBe(200);
    expect(codeOf(await post(alice.user, direct, 'De trop', { via: limited }))).toEqual([
      409,
      'TOO_MANY_MESSAGES',
    ]);
    expect((await post(bob.user, direct, 'Moi, je peux', { via: limited })).status).toBe(200);
    expect(await countOf(alice.houseId)).toEqual([{ n: RATE.messages }]);
  });

  it('débit tenu sous exécutions concurrentes', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const replies = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        post(alice.user, world.kallisteChannel, `Rafale ${i}`, { via: limited }),
      ),
    );
    expect(replies.filter((reply) => reply.status === 200)).toHaveLength(RATE.messages);
    expect(replies.filter((reply) => reply.body.error?.code === 'TOO_MANY_MESSAGES')).toHaveLength(
      8 - RATE.messages,
    );
    expect(await countOf(alice.houseId)).toEqual([{ n: RATE.messages }]);
  });

  it('la fenêtre glisse : un message sorti de la fenêtre ne compte plus', async () => {
    const world = await newWorld();
    const alice = await world.player();
    for (let i = 0; i < RATE.messages; i += 1)
      expect((await post(alice.user, world.kallisteChannel, 'Hier', { via: limited })).status).toBe(
        200,
      );
    // Le plus ancien sort de la fenêtre (garde levée le temps de l'antidater).
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.messages disable trigger messages_guard`.execute(trx);
      await sql`update game.messages set created_at = now() - make_interval(secs => ${RATE.windowSeconds + 1})
        where id = (select id from game.messages where house_id = ${alice.houseId} order by created_at limit 1)`.execute(
        trx,
      );
      await sql`alter table game.messages enable trigger messages_guard`.execute(trx);
    });
    expect((await post(alice.user, world.kallisteChannel, 'Libre', { via: limited })).status).toBe(
      200,
    );
    expect(
      codeOf(await post(alice.user, world.kallisteChannel, 'Plein', { via: limited })),
    ).toEqual([409, 'TOO_MANY_MESSAGES']);
  });

  it('un refus de débit est un refus métier journalisé : il n’est pas compté parmi les refus avant exécution', async () => {
    const refusal = vi.fn<Telemetry['refusal']>();
    const spied = appWith(limitedConfig, {
      refusal,
      adminRead: async () => undefined,
      flush: async () => undefined,
    });
    const world = await newWorld();
    const alice = await world.player();
    for (let i = 0; i < RATE.messages; i += 1)
      expect((await post(alice.user, world.kallisteChannel, 'Vite', { via: spied })).status).toBe(
        200,
      );
    expect(codeOf(await post(alice.user, world.kallisteChannel, 'Trop', { via: spied }))).toEqual([
      409,
      'TOO_MANY_MESSAGES',
    ]);
    expect(refusal).not.toHaveBeenCalled();
    expect(
      await rows(sql`select error_code from game.command_log where user_id = ${alice.user}
        and command = 'chat.post' and status = 'rejected'`),
    ).toEqual([{ error_code: 'TOO_MANY_MESSAGES' }]);
    // Le compteur est bien branché : une requête sans jeton y est comptée.
    expect((await post('', world.kallisteChannel, 'Anonyme', { via: spied })).status).toBe(401);
    expect(refusal).toHaveBeenCalledWith('command', 'unauthenticated');
  });
});
