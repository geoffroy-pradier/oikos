import { randomUUID } from 'node:crypto';
import type { AdminRole } from '@oikos/contracts';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { codeOf, db, newWorld, owner, rows, send } from './chat-test-world';

// Commandes d'administration de la modération (#276), contre Supabase local : rôles, sanction, double validation
// de l'exclusion, masquage. Les comptes de l'équipe sont inscrits par le test ; leurs rôles sont retirés à la fin.
const staff: string[] = [];
afterAll(async () => {
  await sql`delete from admin.roles where user_id = any(${staff}::uuid[])`.execute(owner);
  await Promise.all([db.destroy(), owner.destroy()]);
});
/** Un compte inscrit avec un rôle, accordé par `grantedBy` (nul : le premier super-administrateur). */
async function account(role: AdminRole, grantedBy: string | null) {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  staff.push(id);
  await sql`insert into admin.roles (user_id, role, granted_by) values (${id}, ${role}, ${grantedBy})`.execute(
    owner,
  );
  return id;
}
let root: Promise<string> | undefined;
/** Un compte de l'équipe, à second facteur ; son rôle lui vient d'un super-administrateur inscrit à la main. */
const member = async (role: AdminRole) =>
  `aal2:${await account(role, await (root ??= account('super_admin', null)))}`;
const idOf = (token: string) => token.replace('aal2:', '');
const post = (user: string, channelId: string, body: string) =>
  send(user, 'chat.post', { channelId, body });
const sanctionOf = async (id: string) =>
  (
    await rows(sql<{
      kind: string;
      hours: number | null;
      validated_by: string | null;
      started_late: boolean;
    }>`select kind, extract(epoch from ends_at - starts_at)::int / 3600 as hours, validated_by,
         starts_at > created_at as started_late
       from admin.sanctions where id = ${id}`)
  )[0];

describe('rôles de la modération', () => {
  it('ouvertes au modérateur, au responsable communauté et au super-administrateur, à second facteur', async () => {
    const unknown = { messageId: randomUUID() };
    for (const role of ['moderator', 'community_manager', 'super_admin'] as const)
      expect(codeOf(await send(await member(role), 'admin.hideMessage', unknown))).toEqual([
        404,
        'MESSAGE_NOT_FOUND',
      ]);
    for (const role of ['support', 'observer', 'game_designer'] as const)
      expect(codeOf(await send(await member(role), 'admin.hideMessage', unknown))).toEqual([
        403,
        'FORBIDDEN',
      ]);
    const moderator = idOf(await member('moderator'));
    expect(codeOf(await send(moderator, 'admin.hideMessage', unknown))).toEqual([403, 'FORBIDDEN']);
    const [logged] = await rows(sql<{ status: string; error_code: string; aal: string }>`
      select status, error_code, aal from game.command_log where user_id = ${moderator}`);
    expect(logged).toEqual({ status: 'rejected', error_code: 'FORBIDDEN', aal: 'aal1' });
  });
});

describe('admin.sanction', () => {
  it('un silence d’une durée proposée refuse chat.post ; une durée non proposée ou soi-même sont refusés', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const moderator = await member('moderator');
    const silence = { userId: alice.user, kind: 'silence', hours: 24, reason: 'Insultes répétées' };
    const reply = await send(moderator, 'admin.sanction', silence);
    expect(reply.status).toBe(200);
    expect(reply.body.data).toMatchObject({ kind: 'silence', pending: false });
    expect(await sanctionOf(reply.body.data.sanctionId)).toEqual({
      kind: 'silence',
      hours: 24,
      validated_by: null,
      started_late: false,
    });
    expect(codeOf(await post(alice.user, world.kallisteChannel, 'Chut ?'))).toEqual([
      409,
      'SILENCED',
    ]);
    for (const [input, code] of [
      [{ ...silence, hours: 5 }, 'DURATION_NOT_OFFERED'],
      [{ ...silence, kind: 'suspension', hours: 1 }, 'DURATION_NOT_OFFERED'],
      [{ ...silence, userId: idOf(moderator) }, 'SELF_SANCTION'],
      [{ ...silence, userId: randomUUID() }, 'ACCOUNT_NOT_FOUND'],
      [{ ...silence, kind: 'ban' }, 'VALIDATION_FAILED'],
      [{ ...silence, reason: '  ' }, 'VALIDATION_FAILED'],
    ] as const)
      expect([input, codeOf(await send(moderator, 'admin.sanction', input))[1]]).toEqual([
        input,
        code,
      ]);
    const [{ n } = { n: -1 }] = await rows(sql<{ n: number }>`
      select count(*)::int as n from admin.sanctions where user_id = ${alice.user}`);
    expect(n).toBe(1);
    const events = await rows(sql<{ type: string; payload: unknown; admin_role: string }>`
      select e.type, e.payload, l.admin_role from game.domain_events e
      join game.command_log l on l.id = e.command_id where l.user_id = ${idOf(moderator)}`);
    expect(events).toEqual([
      {
        type: 'SanctionPronounced',
        payload: {
          sanctionId: reply.body.data.sanctionId,
          userId: alice.user,
          kind: 'silence',
          pending: false,
        },
        admin_role: 'moderator',
      },
    ]);
  });

  it('rejouée sous la même clé, elle rend la même réponse sans sanctionner deux fois', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const moderator = await member('community_manager');
    const input = { userId: alice.user, kind: 'warning', hours: 168, reason: 'Ton' };
    const key = randomUUID();
    const first = await send(moderator, 'admin.sanction', input, { key });
    const again = await send(moderator, 'admin.sanction', input, { key });
    expect([again.status, again.replayed, again.body]).toEqual([200, 'true', first.body]);
    const [{ n } = { n: -1 }] = await rows(sql<{ n: number }>`
      select count(*)::int as n from admin.sanctions where user_id = ${alice.user}`);
    expect(n).toBe(1);
  });
});

describe('exclusion : double validation', () => {
  it('proposée, elle n’agit pas ; son auteur et le compte exclu ne la valident pas ; un autre compte, si', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const [dion, eudore] = [await member('moderator'), await member('community_manager')];
    // Alice porte aussi un rôle : même ainsi, elle ne valide pas sa propre exclusion.
    await sql`insert into admin.roles (user_id, role, granted_by) values (${alice.user}, 'moderator', ${await root})`.execute(
      owner,
    );
    staff.push(alice.user);
    const proposed = await send(dion, 'admin.sanction', {
      userId: alice.user,
      kind: 'ban',
      reason: 'Triche avérée',
    });
    expect(proposed.body.data).toMatchObject({ kind: 'ban', endsAt: null, pending: true });
    const sanctionId = proposed.body.data.sanctionId as string;
    expect((await post(alice.user, world.kallisteChannel, 'Encore là.')).status).toBe(200);
    for (const author of [dion, `aal2:${alice.user}`])
      expect(codeOf(await send(author, 'admin.confirmExclusion', { sanctionId }))).toEqual([
        409,
        'SECOND_PERSON_REQUIRED',
      ]);
    expect((await sanctionOf(sanctionId))?.validated_by).toBeNull();
    expect((await post(alice.user, world.kallisteChannel, 'Toujours là.')).status).toBe(200);

    const confirmed = await send(eudore, 'admin.confirmExclusion', { sanctionId });
    expect(confirmed.status).toBe(200);
    expect(await sanctionOf(sanctionId)).toMatchObject({
      validated_by: idOf(eudore),
      started_late: true,
    });
    expect(codeOf(await post(alice.user, world.kallisteChannel, 'Exclue ?'))).toEqual([
      409,
      'SUSPENDED',
    ]);
    expect(codeOf(await send(eudore, 'admin.confirmExclusion', { sanctionId }))).toEqual([
      409,
      'ALREADY_CONFIRMED',
    ]);
    const silence = await send(dion, 'admin.sanction', {
      userId: alice.user,
      kind: 'silence',
      hours: 1,
      reason: 'x',
    });
    const notBan = { sanctionId: silence.body.data.sanctionId };
    expect(codeOf(await send(eudore, 'admin.confirmExclusion', notBan))).toEqual([
      404,
      'SANCTION_NOT_FOUND',
    ]);
  });

  it('deux validations simultanées : une seule passe', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const author = await member('moderator');
    const proposed = await send(author, 'admin.sanction', {
      userId: alice.user,
      kind: 'ban',
      reason: 'Triche',
    });
    const sanctionId = proposed.body.data.sanctionId as string;
    const [b, c] = [await member('moderator'), await member('super_admin')];
    const replies = await Promise.all(
      [b, c].map((who) => send(who, 'admin.confirmExclusion', { sanctionId })),
    );
    expect(replies.map(codeOf).sort()).toEqual([
      [200, undefined],
      [409, 'ALREADY_CONFIRMED'],
    ]);
  });
});

describe('admin.hideMessage', () => {
  it('masque un message une fois : son texte ne se lit plus, il ne se signale plus', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    const posted = await post(alice.user, world.kallisteChannel, 'Propos à masquer');
    const messageId = posted.body.data.messageId as string;
    const [m1, m2] = [await member('moderator'), await member('moderator')];
    const replies = await Promise.all(
      [m1, m2].map((who) => send(who, 'admin.hideMessage', { messageId })),
    );
    expect(replies.map(codeOf).sort()).toEqual([
      [200, undefined],
      [409, 'MESSAGE_HIDDEN'],
    ]);
    expect(
      await rows(sql`select body, visible_body from game.messages where id = ${messageId}`),
    ).toEqual([{ body: 'Propos à masquer', visible_body: null }]);
    expect(codeOf(await send(bob.user, 'chat.report', { messageId, reason: 'spam' }))).toEqual([
      409,
      'MESSAGE_HIDDEN',
    ]);
  });
});

describe('admin.resolveReport', () => {
  it('traite d’un coup les signalements ouverts du message, une fois ; pas par le compte signalé', async () => {
    const world = await newWorld();
    const [alice, bob, chloe] = [await world.player(), await world.player(), await world.player()];
    const posted = await post(bob.user, world.kallisteChannel, 'Achetez mon blé !');
    const messageId = posted.body.data.messageId as string;
    const reportIds: string[] = [];
    for (const reporter of [alice, chloe])
      reportIds.push(
        (await send(reporter.user, 'chat.report', { messageId, reason: 'spam' })).body.data
          .reportId,
      );
    // Bob et Alice portent aussi un rôle : ni le signalé ni qui a signalé ne traitent le message, même par le
    // signalement d'un autre.
    for (const who of [bob, alice]) {
      await sql`insert into admin.roles (user_id, role, granted_by) values (${who.user}, 'moderator', ${await root})`.execute(
        owner,
      );
      staff.push(who.user);
    }
    const target = { reportId: reportIds[1], decision: 'upheld' };
    for (const who of [bob, alice])
      expect(codeOf(await send(`aal2:${who.user}`, 'admin.resolveReport', target))).toEqual([
        409,
        'SECOND_PERSON_REQUIRED',
      ]);
    const [m1, m2] = [await member('moderator'), await member('community_manager')];
    const replies = await Promise.all([
      send(m1, 'admin.resolveReport', target),
      send(m2, 'admin.resolveReport', { reportId: reportIds[0], decision: 'dismissed' }),
    ]);
    const passed = replies.filter((reply) => reply.status === 200);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.body.data.reportIds).toEqual(reportIds);
    expect(replies.map(codeOf).filter(([status]) => status !== 200)).toEqual([
      [409, 'ALREADY_RESOLVED'],
    ]);
    const states = await rows(sql<{ state: string; resolved_by: string }>`
      select distinct state, resolved_by from game.reports where message_id = ${messageId}`);
    expect(states).toEqual([
      {
        state: passed[0]?.body.data.decision,
        resolved_by: idOf(replies[0] === passed[0] ? m1 : m2),
      },
    ]);
    expect(
      codeOf(await send(m1, 'admin.resolveReport', { reportId: randomUUID(), decision: 'upheld' })),
    ).toEqual([404, 'REPORT_NOT_FOUND']);
  });
});

describe('admin.decideAppeal', () => {
  it('rejeté, la sanction court ; accueilli, elle est levée ; ni l’auteur ni deux fois', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const [dion, eudore, phedon] = [
      await member('moderator'),
      await member('moderator'),
      await member('super_admin'),
    ];
    const pronounce = async (kind: string, hours: number) =>
      (await send(dion, 'admin.sanction', { userId: alice.user, kind, hours, reason: 'Spam' })).body
        .data.sanctionId as string;
    const [suspension, warning] = [
      await pronounce('suspension', 24),
      await pronounce('warning', 168),
    ];
    const decide = (who: string, sanctionId: string, decision: string) =>
      send(who, 'admin.decideAppeal', { sanctionId, decision });
    expect(codeOf(await decide(eudore, warning, 'granted'))).toEqual([409, 'NOT_APPEALED']);
    for (const sanctionId of [suspension, warning])
      expect(
        (await send(alice.user, 'moderation.appeal', { sanctionId, body: 'Je conteste.' })).status,
      ).toBe(200);
    expect(codeOf(await decide(dion, suspension, 'granted'))).toEqual([
      409,
      'SECOND_PERSON_REQUIRED',
    ]);

    const rejected = await decide(eudore, warning, 'rejected');
    expect(rejected.body.data).toEqual({
      sanctionId: warning,
      decision: 'rejected',
      liftedAt: null,
    });
    // Deux décisions simultanées : une seule passe ; rejeté, l'appel laisse courir la suspension.
    const both = await Promise.all([
      decide(eudore, suspension, 'rejected'),
      decide(phedon, suspension, 'rejected'),
    ]);
    expect(both.map(codeOf).sort()).toEqual([
      [200, undefined],
      [409, 'APPEAL_DECIDED'],
    ]);
    expect(codeOf(await post(alice.user, world.kallisteChannel, 'Libre ?'))).toEqual([
      409,
      'SUSPENDED',
    ]);
    const [decided] = await rows(sql<{ by: string; lifted: boolean }>`
      select appeal_decided_by as by, lifted_at is not null as lifted
      from admin.sanctions where id = ${suspension}`);
    expect(decided).toEqual({ by: idOf(both[0]?.status === 200 ? eudore : phedon), lifted: false });
    expect(codeOf(await decide(eudore, randomUUID(), 'granted'))).toEqual([
      404,
      'SANCTION_NOT_FOUND',
    ]);
  });

  it('accueilli, un appel lève la suspension : le compte rejoue ses commandes, et ne refait pas appel', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const [dion, eudore] = [await member('moderator'), await member('moderator')];
    const pronounced = await send(dion, 'admin.sanction', {
      userId: alice.user,
      kind: 'suspension',
      hours: 168,
      reason: 'Triche supposée',
    });
    const sanctionId = pronounced.body.data.sanctionId as string;
    expect(codeOf(await post(alice.user, world.kallisteChannel, 'Suspendue ?'))).toEqual([
      409,
      'SUSPENDED',
    ]);
    await send(alice.user, 'moderation.appeal', { sanctionId, body: 'Erreur.' });
    const granted = await send(eudore, 'admin.decideAppeal', { sanctionId, decision: 'granted' });
    expect(granted.body.data.liftedAt).toEqual(expect.any(String));
    expect((await post(alice.user, world.kallisteChannel, 'Merci.')).status).toBe(200);
    expect(
      codeOf(await send(alice.user, 'moderation.appeal', { sanctionId, body: 'Encore.' })),
    ).toEqual([409, 'SANCTION_ENDED']);
    const events = await rows(sql<{ type: string; payload: unknown }>`
      select e.type, e.payload from game.domain_events e
      join game.command_log l on l.id = e.command_id where l.user_id = ${idOf(eudore)}`);
    expect(events).toEqual([
      { type: 'AppealDecided', payload: { sanctionId, decision: 'granted', lifted: true } },
    ]);
  });
});
