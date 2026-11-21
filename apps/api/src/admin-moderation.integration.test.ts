import { randomUUID } from 'node:crypto';
import { adminReportsSchema, type AdminRole } from '@oikos/contracts';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { appWith, codeOf, db, newWorld, owner, rows, send } from './chat-test-world';
import { TEST_CONFIG, testConfig } from './test-config';

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

/** Décisions sur ses appels, lues par le joueur comme le client (#529) : vue `my_appeal_decisions`, à son nom. */
const decisionsSeenBy = (user: string) =>
  owner.transaction().execute(async (trx) => {
    await sql`set local role authenticated`.execute(trx);
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: 'authenticated' })}, true)`.execute(
      trx,
    );
    const { rows: seen } = await sql<{ sanction_id: string; decision: string; at_lift: boolean }>`
      select d.sanction_id, d.decision, d.decided_at = s.ends_at as at_lift
      from public.my_appeal_decisions d join public.my_sanctions s on s.id = d.sanction_id
      order by d.decided_at, d.sanction_id`.execute(trx);
    return seen;
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
    // Le joueur lit la décision, levée à son instant ; un autre joueur ne la lit pas.
    expect(await decisionsSeenBy(alice.user)).toEqual([
      { sanction_id: sanctionId, decision: 'granted', at_lift: true },
    ]);
    expect(await decisionsSeenBy((await world.player()).user)).toEqual([]);
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

describe('GET /api/admin/reports', () => {
  const app = appWith(testConfig);
  const read = async (token: string, path = 'reports') => {
    const res = await app.request(`/api/admin/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: res.status, body: (await res.json()) as { data?: unknown } };
  };

  it('rend la file, le contexte, les appels et les exclusions à valider, et rien d’autre', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    for (const [who, body] of [
      [alice, 'Avant'],
      [bob, 'Propos signalé'],
      [alice, 'Après'],
    ] as const)
      await post(who.user, world.kallisteChannel, body);
    const [signaled] = await rows(sql<{ id: string }>`
      select id from game.messages where house_id = ${bob.houseId}`);
    const messageId = signaled?.id ?? '';
    const reported = await send(alice.user, 'chat.report', { messageId, reason: 'spam' });
    const moderator = await member('moderator');
    const suspended = await send(moderator, 'admin.sanction', {
      userId: alice.user,
      kind: 'suspension',
      hours: 24,
      reason: 'Spam',
    });
    const sanctionId = suspended.body.data.sanctionId as string;
    await send(alice.user, 'moderation.appeal', { sanctionId, body: 'Ce n’est pas moi.' });
    const ban = await send(moderator, 'admin.sanction', {
      userId: bob.user,
      kind: 'ban',
      reason: 'x',
    });

    const reply = await read(await member('moderator'));
    expect(reply.status).toBe(200);
    // Objets stricts : une clé de plus (une donnée économique, la maison qui signale) ferait échouer la lecture.
    const data = adminReportsSchema.parse(reply.body.data);
    const entry = data.queue.find((item) => item.message?.id === messageId);
    expect(entry).toMatchObject({
      reportedHouse: { id: bob.houseId, userId: bob.user },
      channel: { id: world.kallisteChannel, kind: 'city', city: 'kalliste' },
      message: { body: 'Propos signalé', hiddenAt: null },
      reports: [{ id: reported.body.data.reportId, reason: 'spam' }],
    });
    expect(entry?.context.map((item) => item.body)).toEqual(['Avant', 'Après']);
    expect(data.appeals.find((item) => item.sanctionId === sanctionId)).toMatchObject({
      userId: alice.user,
      appealBody: 'Ce n’est pas moi.',
    });
    expect(data.pendingExclusions.map((item) => item.sanctionId)).toContain(
      ban.body.data.sanctionId,
    );
    // Traité, le signalement quitte la file.
    const resolved = await send(moderator, 'admin.resolveReport', {
      reportId: reported.body.data.reportId,
      decision: 'upheld',
    });
    expect(resolved.status).toBe(200);
    const after = adminReportsSchema.parse((await read(moderator)).body.data);
    expect(after.queue.some((item) => item.message?.id === messageId)).toBe(false);
  });

  it('montre d’abord les violations probables du pré-tri avec catégorie et résumé, sans pré-tri l’ordre de la phase 2 (#763)', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    // Trois messages de Bob, signalés dans cet ordre par Alice : le plus ancien d'abord à la phase 2.
    const ids: string[] = [];
    for (const body of ['Un', 'Deux', 'Trois']) {
      const messageId = (await post(bob.user, world.kallisteChannel, body)).body.data
        .messageId as string;
      ids.push(messageId);
      await send(alice.user, 'chat.report', { messageId, reason: 'spam' });
    }
    const moderator = await member('moderator');
    const order = async () => {
      const data = adminReportsSchema.parse((await read(moderator)).body.data);
      return data.queue
        .filter((item) => ids.includes(item.message?.id ?? ''))
        .map((item) => [item.message?.id, item.triage ?? null] as const);
    };
    expect((await order()).map(([id]) => id)).toEqual(ids);
    expect((await order()).map(([, triage]) => triage)).toEqual([null, null, null]);
    await sql`insert into game.report_triage (message_id, category, summary, outcome) values
      (${ids[0]}, 'likely_unfounded', 'Rien de répréhensible.', 'ok'),
      (${ids[2]}, 'likely_violation', 'Pourriel commercial.', 'ok')`.execute(owner);
    await sql`insert into game.report_triage (message_id, outcome) values (${ids[1]}, 'timeout')`.execute(
      owner,
    );
    // Violation probable, puis sans catégorie, puis probablement infondé.
    expect(await order()).toEqual([
      [ids[2], { category: 'likely_violation', summary: 'Pourriel commercial.' }],
      [ids[1], null],
      [ids[0], { category: 'likely_unfounded', summary: 'Rien de répréhensible.' }],
    ]);
  });

  it('ouverte aux seuls rôles de la modération ; le modérateur ne lit aucun autre module', async () => {
    const moderator = await member('moderator');
    for (const path of ['vigie', 'economy', 'config/versions', 'audit', 'roles', 'events'])
      expect([path, (await read(moderator, path)).status]).toEqual([path, 403]);
    for (const role of ['support', 'observer', 'game_designer'] as const)
      expect([role, (await read(await member(role))).status]).toEqual([role, 403]);
    expect((await read(idOf(moderator))).status).toBe(403);
    expect((await read(await member('community_manager'))).status).toBe(200);
    expect(
      await rows(sql`select route, status from telemetry.admin_reads where user_id = ${idOf(moderator)}
      order by created_at, id`),
    ).toEqual([
      ...['vigie', 'economy', 'config/versions', 'audit', 'roles', 'events'].map((path) => ({
        route: `/api/admin/${path}`,
        status: 403,
      })),
    ]);
  });

  it('rend les durées de la version en vigueur, celles qu’admin.sanction accepte, et rien d’autre (#541)', async () => {
    const sanctionHours = { warning: [2], silence: [3, 5], suspension: [7] };
    const loaded = {
      ...TEST_CONFIG,
      config: {
        ...TEST_CONFIG.config,
        moderation: { ...TEST_CONFIG.config.moderation, bannedTerms: ['secret'], sanctionHours },
      },
    };
    const via = appWith(async () => loaded);
    const moderator = await member('moderator');
    const res = await via.request('/api/admin/reports', {
      headers: { authorization: `Bearer ${moderator}` },
    });
    expect(res.status).toBe(200);
    // Contrat strict : les termes interdits, ou toute autre valeur de la configuration, feraient échouer la lecture.
    const data = adminReportsSchema.parse(((await res.json()) as { data: unknown }).data);
    expect(data.sanctionHours).toEqual(sanctionHours);
    expect(JSON.stringify(data)).not.toContain('secret');
    // La version de `testConfig` rend les siennes.
    const initial = adminReportsSchema.parse((await read(moderator)).body.data);
    expect(initial.sanctionHours).toEqual(TEST_CONFIG.config.moderation.sanctionHours);
    // Chaque durée rendue passe la commande, sous la même version ; une durée de l'autre version y est refusée.
    const target = (await (await newWorld()).player()).user;
    for (const [kind, hours] of Object.entries(sanctionHours).flatMap(([kind, list]) =>
      list.map((h) => [kind, h] as const),
    ))
      expect([
        kind,
        hours,
        (
          await send(
            moderator,
            'admin.sanction',
            { userId: target, kind, hours, reason: 'x' },
            { via },
          )
        ).status,
      ]).toEqual([kind, hours, 200]);
    const offered = { userId: target, kind: 'silence', hours: 24, reason: 'x' };
    expect(codeOf(await send(moderator, 'admin.sanction', offered))[0]).toBe(200);
    expect(codeOf(await send(moderator, 'admin.sanction', offered, { via }))[1]).toBe(
      'DURATION_NOT_OFFERED',
    );
    // Les rôles hors de la modération ne lisent pas ces durées.
    for (const role of ['support', 'observer', 'game_designer'] as const) {
      const refused = await via.request('/api/admin/reports', {
        headers: { authorization: `Bearer ${await member(role)}` },
      });
      expect([role, refused.status, ((await refused.json()) as { data?: unknown }).data]).toEqual([
        role,
        403,
        undefined,
      ]);
    }
  });
});

describe('signalements en attente depuis plus que le seuil (15.5, #530)', () => {
  const staleWith = async (hours: number) => {
    const config = {
      ...TEST_CONFIG,
      config: {
        ...TEST_CONFIG.config,
        moderation: { ...TEST_CONFIG.config.moderation, staleReportHours: hours },
      },
    };
    const res = await appWith(async () => config).request('/api/admin/vigie', {
      headers: { authorization: `Bearer ${await member('observer')}` },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { staleReports: Record<string, number | null> } }).data
      .staleReports;
  };

  it('compte les signalements ouverts plus anciens que le seuil de la configuration, et rend ce seuil', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    for (const body of ['Ancien', 'Récent']) await post(bob.user, world.kallisteChannel, body);
    const messages = await rows(sql<{ id: string }>`
      select id from game.messages where house_id = ${bob.houseId} order by body`);
    const [before24, before48] = [await staleWith(24), await staleWith(48)];
    const [old, recent] = messages.map((m) => m.id);
    for (const messageId of [old, recent])
      expect((await send(alice.user, 'chat.report', { messageId, reason: 'spam' })).status).toBe(
        200,
      );
    // Un signalement est immuable et daté de sa transaction : l'essai en recule un sans les gardes.
    await owner.transaction().execute(async (tx) => {
      await sql`set local session_replication_role = replica`.execute(tx);
      await sql`update game.reports set created_at = now() - interval '30 hours'
        where message_id = ${old}`.execute(tx);
    });
    const [after24, after48] = [await staleWith(24), await staleWith(48)];
    expect(after24).toMatchObject({ afterHours: 24, count: (before24.count ?? 0) + 1 });
    expect(after24.oldestHours).toBeGreaterThanOrEqual(30);
    expect(after48).toMatchObject({ afterHours: 48, count: before48.count });
    // Traité, il n'attend plus.
    const moderator = await member('moderator');
    const [report] = await rows(
      sql<{ id: string }>`select id from game.reports where message_id = ${old}`,
    );
    await send(moderator, 'admin.resolveReport', { reportId: report?.id, decision: 'dismissed' });
    expect((await staleWith(24)).count).toBe(before24.count);
    const queue = adminReportsSchema.parse(
      (
        (await (
          await appWith(testConfig).request('/api/admin/reports', {
            headers: { authorization: `Bearer ${moderator}` },
          })
        ).json()) as { data: unknown }
      ).data,
    );
    expect(queue.staleAfterHours).toBe(TEST_CONFIG.config.moderation.staleReportHours);
  });
});

describe('le pré-tri de l’IA ne décide d’aucune sanction (#763)', () => {
  it('une catégorie, quelle qu’elle soit, ne change le résultat d’aucune commande de modération', async () => {
    const world = await newWorld();
    const [alice, bob, chloe] = [await world.player(), await world.player(), await world.player()];
    const moderator = await member('moderator');
    const other = await member('community_manager');
    const cases: [typeof bob, string, string][] = [];
    for (const [author, category, summary] of [
      [bob, 'likely_unfounded', 'Rien de répréhensible.'],
      [chloe, 'likely_violation', 'Insulte.'],
    ] as const) {
      const messageId = (await post(author.user, world.kallisteChannel, 'Propos')).body.data
        .messageId as string;
      const reportId = (await send(alice.user, 'chat.report', { messageId, reason: 'harassment' }))
        .body.data.reportId as string;
      await sql`insert into game.report_triage (message_id, category, summary, outcome)
        values (${messageId}, ${category}, ${summary}, 'ok')`.execute(owner);
      cases.push([author, messageId, reportId]);
    }
    const [unfounded, violation] = cases as [(typeof cases)[number], (typeof cases)[number]];
    // Masquer, sanctionner et traiter passent pareil, d'un message « probablement infondé » comme d'une « violation
    // probable » : la décision reste celle du modérateur, dans les deux sens.
    for (const [author, messageId, reportId] of [unfounded, violation]) {
      expect((await send(moderator, 'admin.hideMessage', { messageId })).status).toBe(200);
      const sanction = await send(moderator, 'admin.sanction', {
        userId: author.user,
        kind: 'warning',
        hours: 168,
        reason: 'Propos',
      });
      expect(sanction.status).toBe(200);
      expect(sanction.body.data).toMatchObject({ kind: 'warning', pending: false });
      expect(
        (await send(other, 'admin.resolveReport', { reportId, decision: 'upheld' })).status,
      ).toBe(200);
    }
    const after = await rows(sql<{ category: string; summary: string }>`
      select category, summary from game.report_triage
      where message_id = any(${[unfounded[1], violation[1]]}::uuid[]) order by category`);
    expect(after.map((row) => row.category)).toEqual(['likely_unfounded', 'likely_violation']);
    const states = await rows(sql<{ state: string }>`
      select state from game.reports where id = any(${[unfounded[2], violation[2]]}::uuid[])`);
    expect(states.map((row) => row.state)).toEqual(['upheld', 'upheld']);
  });
});
