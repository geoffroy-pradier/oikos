import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { codeOf, db, newWorld, openDirect, owner, rows } from './chat-test-world';
import { newAccount } from './test-config';

// Conversations privées (6.6), contre Supabase local.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

describe('chat.openDirect', () => {
  it('ouvre une conversation entre deux maisons de cités différentes, une seule, quel que soit qui l’ouvre', async () => {
    const world = await newWorld();
    const [alice, chloe] = [await world.player(), await world.player(world.elaia)];
    const key = randomUUID();
    const first = await openDirect(alice.user, chloe.houseId, { key });
    expect(first.body).toMatchObject({ ok: true, data: { houseId: chloe.houseId, created: true } });
    const channelId = first.body.data.channelId as string;
    expect(await openDirect(alice.user, chloe.houseId, { key })).toMatchObject({
      replayed: 'true',
      body: first.body,
    });
    expect((await openDirect(chloe.user, alice.houseId)).body.data).toEqual({
      channelId,
      houseId: alice.houseId,
      created: false,
    });
    expect(
      await rows(
        sql`select house_id from game.channel_members where channel_id = ${channelId} order by house_id`,
      ),
    ).toEqual([alice.houseId, chloe.houseId].sort().map((house_id) => ({ house_id })));
    expect(
      await rows(
        sql`select payload from game.domain_events where type = 'DirectChannelOpened' and payload->>'channelId' = ${channelId}`,
      ),
    ).toEqual([{ payload: { channelId, houseId: alice.houseId, otherHouseId: chloe.houseId } }]);
  });

  it('refuse la conversation avec soi-même, une maison inconnue ou d’un autre monde, un compte sans maison', async () => {
    const [world, elsewhere] = [await newWorld(), await newWorld()];
    const [alice, dion] = [await world.player(), await elsewhere.player()];
    expect(codeOf(await openDirect(alice.user, alice.houseId))).toEqual([409, 'SELF_CONVERSATION']);
    expect(codeOf(await openDirect(alice.user, alice.houseId.toUpperCase()))).toEqual([
      409,
      'SELF_CONVERSATION',
    ]);
    expect(codeOf(await openDirect(alice.user, randomUUID()))).toEqual([
      404,
      'RECIPIENT_NOT_FOUND',
    ]);
    expect(codeOf(await openDirect(alice.user, dion.houseId))).toEqual([
      404,
      'RECIPIENT_NOT_FOUND',
    ]);
    expect(codeOf(await openDirect(await newAccount(owner), alice.houseId))).toEqual([
      404,
      'HOUSE_NOT_FOUND',
    ]);
    expect(
      await rows(
        sql`select id from game.channels where ${alice.houseId} in (house_low, house_high)`,
      ),
    ).toEqual([]);
  });

  it('sous concurrence, dans les deux sens : une conversation, une création, deux membres', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    const replies = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        i % 2 ? openDirect(alice.user, bob.houseId) : openDirect(bob.user, alice.houseId),
      ),
    );
    expect(replies.map((reply) => reply.status)).toEqual(Array(8).fill(200));
    expect(new Set(replies.map((reply) => reply.body.data.channelId)).size).toBe(1);
    expect(replies.filter((reply) => reply.body.data.created)).toHaveLength(1);
    const channelId = replies[0]?.body.data.channelId as string;
    expect(
      await rows(
        sql`select count(*)::int as n from game.channel_members where channel_id = ${channelId}`,
      ),
    ).toEqual([{ n: 2 }]);
  });

  it('une maison d’un autre monde reste hors d’atteinte : un compte n’a qu’une maison dans tout le jeu (#604)', async () => {
    const [first, second] = [await newWorld(), await newWorld()];
    const alice = await first.player();
    const bob = await second.player();
    await expect(second.player(second.kalliste, false, alice.user)).rejects.toThrow('409');
    expect(codeOf(await openDirect(alice.user, bob.houseId))).toEqual([404, 'RECIPIENT_NOT_FOUND']);
    expect(
      await rows(sql`select count(*)::int as n from game.houses where user_id = ${alice.user}`),
    ).toEqual([{ n: 1 }]);
  });
});
