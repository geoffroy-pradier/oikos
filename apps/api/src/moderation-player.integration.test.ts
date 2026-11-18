import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { appWith, codeOf, db, newWorld, openDirect, owner, rows, send } from './chat-test-world';
import { TEST_CONFIG } from './test-config';

// Signalement et appel (#275), contre Supabase local. Les sanctions sont écrites par le test.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const post = async (user: string, channelId: string, body: string) =>
  (await send(user, 'chat.post', { channelId, body })).body.data.messageId as string;
const report = (user: string, messageId: string, reason = 'spam', key = randomUUID()) =>
  send(user, 'chat.report', { messageId, reason }, { key });
const appeal = (user: string, sanctionId: string, body: string, key = randomUUID()) =>
  send(user, 'moderation.appeal', { sanctionId, body }, { key });
const events = (type: string, key: string, id: string) =>
  rows(
    sql`select payload from game.domain_events where type = ${type} and payload->>${key} = ${id}`,
  );

/** Sanction de `user`, finie depuis une heure si `ended`, sinon en vigueur pendant une heure. */
async function sanction(user: string, kind = 'silence', ended = false, validated = true) {
  const [author, validator] = [randomUUID(), randomUUID()];
  await sql`insert into auth.users (id, email)
    values (${author}, ${`${author}@example.test`}), (${validator}, ${`${validator}@example.test`})`.execute(
    owner,
  );
  const [row] = await rows(sql<{ id: string }>`
    insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id, validated_by)
    values (${user}, ${kind}, now() - interval '2 hours',
            case when ${kind} = 'ban' then null when ${ended} then now() - interval '1 hour' else now() + interval '1 hour' end,
            'Essai', ${author}, case when ${validated} and ${kind} = 'ban' then ${validator}::uuid end)
    returning id`);
  return row?.id ?? '';
}

describe('chat.report', () => {
  it('une maison signale un message d’une autre maison d’un canal qu’elle lit, une fois', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    const message = await post(bob.user, world.kallisteChannel, 'Achetez mon vin !');
    const first = await report(alice.user, message);
    expect(first.body).toMatchObject({ ok: true, data: { messageId: message } });
    const reportId = first.body.data.reportId as string;
    expect(
      await rows(
        sql`select message_id, reported_house_id, house_id, reason, state from game.reports where id = ${reportId}`,
      ),
    ).toEqual([
      {
        message_id: message,
        reported_house_id: bob.houseId,
        house_id: alice.houseId,
        reason: 'spam',
        state: 'open',
      },
    ]);
    expect(await events('MessageReported', 'reportId', reportId)).toEqual([
      { payload: { reportId, messageId: message, houseId: alice.houseId, reason: 'spam' } },
    ]);
    expect(codeOf(await report(alice.user, message, 'hate'))).toEqual([409, 'ALREADY_REPORTED']);
    // Une autre maison peut signaler le même message.
    expect((await report((await world.player()).user, message)).status).toBe(200);
  });

  it('deux signalements simultanés du même message : un seul est écrit', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    const message = await post(bob.user, world.kallisteChannel, 'Propos');
    const replies = await Promise.all([report(alice.user, message), report(alice.user, message)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect(
      await rows(sql`select count(*)::int as n from game.reports where message_id = ${message}`),
    ).toEqual([{ n: 1 }]);
  });

  it('refuse son propre message, un message masqué, illisible ou inconnu, un motif hors configuration', async () => {
    const world = await newWorld();
    const [alice, bob, chloe] = [
      await world.player(),
      await world.player(),
      await world.player(world.elaia),
    ];
    const own = await post(alice.user, world.kallisteChannel, 'Le mien');
    const hidden = await post(bob.user, world.kallisteChannel, 'Masqué');
    await sql`update game.messages set hidden_at = now() where id = ${hidden}`.execute(owner);
    const direct = (await openDirect(alice.user, bob.houseId)).body.data.channelId as string;
    const secret = await post(bob.user, direct, 'En privé');
    expect(codeOf(await report(alice.user, own))).toEqual([409, 'OWN_MESSAGE']);
    expect(codeOf(await report(alice.user, hidden))).toEqual([409, 'MESSAGE_HIDDEN']);
    for (const messageId of [own, secret, randomUUID()])
      expect(codeOf(await report(chloe.user, messageId))).toEqual([404, 'MESSAGE_NOT_FOUND']);
    expect(codeOf(await report(alice.user, secret, 'gossip'))).toEqual([404, 'REASON_NOT_FOUND']);
    expect((await report(alice.user, secret, 'other')).status).toBe(200);
    const nobody = randomUUID();
    await sql`insert into auth.users (id, email) values (${nobody}, ${`${nobody}@example.test`})`.execute(
      owner,
    );
    expect(codeOf(await report(nobody, secret))).toEqual([404, 'HOUSE_NOT_FOUND']);
    expect(
      await rows(
        sql`select count(*)::int as n from game.reports where house_id = ${chloe.houseId}`,
      ),
    ).toEqual([{ n: 0 }]);
  });

  it('un compte réduit au silence signale encore ; un compte suspendu, non', async () => {
    const world = await newWorld();
    const [alice, bob, chloe] = [await world.player(), await world.player(), await world.player()];
    const message = await post(bob.user, world.kallisteChannel, 'Propos');
    await sanction(alice.user, 'silence');
    await sanction(chloe.user, 'suspension');
    expect((await report(alice.user, message)).status).toBe(200);
    expect(codeOf(await report(chloe.user, message))).toEqual([409, 'SUSPENDED']);
  });
});

describe('moderation.appeal', () => {
  it('un appel par sanction en vigueur, daté par la base, même pour un compte suspendu ou exclu', async () => {
    const world = await newWorld();
    const alice = await world.player();
    for (const kind of ['suspension', 'ban']) {
      const id = await sanction(alice.user, kind);
      const key = randomUUID();
      const first = await appeal(alice.user, id, '  Je conteste.  ', key);
      expect(first.body).toMatchObject({ ok: true, data: { sanctionId: id } });
      expect(
        await rows(sql`select appeal_body, abs(extract(epoch from appealed_at - ${first.body.data.appealedAt}::timestamptz)) < 0.001 as dated
          from admin.sanctions where id = ${id}`),
      ).toEqual([{ appeal_body: 'Je conteste.', dated: true }]);
      expect(await events('SanctionAppealed', 'sanctionId', id)).toEqual([
        { payload: { sanctionId: id } },
      ]);
      const replay = await appeal(alice.user, id, '  Je conteste.  ', key);
      expect([replay.replayed, replay.body]).toEqual(['true', first.body]);
      expect(codeOf(await appeal(alice.user, id, 'Encore.'))).toEqual([409, 'ALREADY_APPEALED']);
    }
    // Le journal ne garde pas le texte de l'appel.
    expect(
      JSON.stringify(
        await rows(sql`select input from game.command_log where user_id = ${alice.user}
        and command = 'moderation.appeal'`),
      ),
    ).not.toMatch(/conteste|Encore/);
  });

  it('deux appels simultanés de la même sanction : un seul est écrit', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const id = await sanction(alice.user);
    const replies = await Promise.all([
      appeal(alice.user, id, 'Un'),
      appeal(alice.user, id, 'Deux'),
    ]);
    expect(replies.map(codeOf).sort()).toEqual([
      [200, undefined],
      [409, 'ALREADY_APPEALED'],
    ]);
    expect(
      await rows(sql`select count(*)::int as n from game.domain_events where type = 'SanctionAppealed'
        and payload->>'sanctionId' = ${id}`),
    ).toEqual([{ n: 1 }]);
  });

  it('refuse la sanction d’un autre compte, une exclusion pas validée, une sanction finie, un texte trop long', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    const bobs = await sanction(bob.user);
    expect(codeOf(await appeal(alice.user, bobs, 'Pour Bob'))).toEqual([404, 'SANCTION_NOT_FOUND']);
    expect(codeOf(await appeal(alice.user, randomUUID(), 'Inconnue'))).toEqual([
      404,
      'SANCTION_NOT_FOUND',
    ]);
    const pending = await sanction(alice.user, 'ban', false, false);
    expect(codeOf(await appeal(alice.user, pending, 'Pas encore'))).toEqual([
      404,
      'SANCTION_NOT_FOUND',
    ]);
    const ended = await sanction(alice.user, 'silence', true);
    expect(codeOf(await appeal(alice.user, ended, 'Trop tard'))).toEqual([409, 'SANCTION_ENDED']);
    const current = await sanction(alice.user);
    const max = TEST_CONFIG.config.moderation.maxAppealLength;
    const short = appWith(async () => ({
      ...TEST_CONFIG,
      config: {
        ...TEST_CONFIG.config,
        moderation: { ...TEST_CONFIG.config.moderation, maxAppealLength: 5 },
      },
    }));
    expect(
      codeOf(
        await send(
          alice.user,
          'moderation.appeal',
          { sanctionId: current, body: '🦉'.repeat(6) },
          { via: short },
        ),
      ),
    ).toEqual([409, 'APPEAL_TOO_LONG']);
    expect(
      (
        await send(
          alice.user,
          'moderation.appeal',
          { sanctionId: current, body: ` ${'🦉'.repeat(5)} ` },
          { via: short },
        )
      ).status,
    ).toBe(200);
    expect(
      codeOf(await appeal(alice.user, await sanction(alice.user), 'a'.repeat(max + 1))),
    ).toEqual([409, 'APPEAL_TOO_LONG']);
  });
});
