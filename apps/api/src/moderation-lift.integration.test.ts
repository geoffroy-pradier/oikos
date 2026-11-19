import { randomUUID } from 'node:crypto';
import { adminReportsSchema } from '@oikos/contracts';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { appWith, codeOf, db, newWorld, owner, rows, send } from './chat-test-world';
import { testConfig } from './test-config';

// Retrait d'une exclusion proposée et levée d'une sanction sans appel (#531), contre Supabase local. Les comptes de
// l'équipe sont inscrits par le test ; leurs rôles sont retirés à la fin.
const staff: string[] = [];
afterAll(async () => {
  await sql`delete from admin.roles where user_id = any(${staff}::uuid[])`.execute(owner);
  await Promise.all([db.destroy(), owner.destroy()]);
});
const grant = async (id: string, grantedBy: string | null) => {
  staff.push(id);
  await sql`insert into admin.roles (user_id, role, granted_by) values (${id}, 'moderator', ${grantedBy})`.execute(
    owner,
  );
};
let root: Promise<string> | undefined;
const superAdmin = async () => {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  staff.push(id);
  await sql`insert into admin.roles (user_id, role) values (${id}, 'super_admin')`.execute(owner);
  return id;
};
/** Un compte de la modération, à second facteur. */
async function moderator() {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  await grant(id, await (root ??= superAdmin()));
  return `aal2:${id}`;
}
const idOf = (token: string) => token.replace('aal2:', '');

const buy = (user: string, cityId: string, price: number, quantity: number) =>
  send(user, 'market.placeOrder', { cityId, goodId: 'wheat', side: 'buy', price, quantity });
/** Trésorerie et séquestre d'une maison, en oboles. */
async function money(houseId: string) {
  const found = await rows(sql<{ kind: string; balance: string }>`
    select kind, balance from game.accounts where house_id = ${houseId}`);
  const of = (kind: string) => Number(found.find((row) => row.kind === kind)?.balance ?? 0);
  return { treasury: of('house'), escrow: of('escrow') };
}
const statusOf = async (ids: string[]) =>
  (
    await rows(sql<{ status: string }>`
      select status from game.orders where id = any(${ids}::uuid[]) order by array_position(${ids}::uuid[], id)`)
  ).map((row) => row.status);
const entriesOf = async (worldId: string) =>
  (
    await rows(sql<{ n: number }>`
      select count(*)::int as n from game.ledger_entries where world_id = ${worldId}`)
  )[0]?.n;
/** Exclusions de la file, d'après la fonction que lit `GET /api/admin/reports`. */
const pendingIds = async () =>
  (
    await rows(sql<{ id: string }>`
      select e ->> 'sanctionId' as id
      from jsonb_array_elements(admin.moderation_queue(0, 10000) -> 'pendingExclusions') e`)
  ).map((row) => row.id);
async function propose(user: string, by?: string) {
  const reply = await send(by ?? (await moderator()), 'admin.sanction', {
    userId: user,
    kind: 'ban',
    reason: 'Triche avérée',
  });
  expect(reply.status).toBe(200);
  return reply.body.data.sanctionId as string;
}
async function pronounce(user: string, kind: 'silence' | 'suspension', hours: number) {
  const author = await moderator();
  const reply = await send(author, 'admin.sanction', { userId: user, kind, hours, reason: 'Ton' });
  expect(reply.status).toBe(200);
  return { author, sanctionId: reply.body.data.sanctionId as string };
}
const eventsOf = async (token: string) =>
  rows(sql<{ command: string; type: string; payload: unknown }>`
    select l.command, e.type, e.payload from game.domain_events e
    join game.command_log l on l.id = e.command_id where l.user_id = ${idOf(token)} order by e.id`);

describe('admin.withdrawExclusion', () => {
  it('retire une exclusion proposée, qui quitte la file et ne se valide plus ; rien n’est annulé', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const placed = await buy(alice.user, world.kalliste, 5, 2);
    expect(placed.status).toBe(200);
    const author = await moderator();
    const sanctionId = await propose(alice.user, author);
    expect(await pendingIds()).toContain(sanctionId);
    // Alice porte aussi un rôle : elle ne retire pas sa propre exclusion.
    await grant(alice.user, await (root ??= superAdmin()));
    const aliceStaff = `aal2:${alice.user}`;
    expect(codeOf(await send(aliceStaff, 'admin.withdrawExclusion', { sanctionId }))).toEqual([
      409,
      'SECOND_PERSON_REQUIRED',
    ]);
    const before = await money(alice.houseId);

    const key = randomUUID();
    const withdrawn = await send(author, 'admin.withdrawExclusion', { sanctionId }, { key });
    expect(withdrawn.status).toBe(200);
    expect(Object.keys(withdrawn.body.data).sort()).toEqual(['sanctionId', 'withdrawnAt']);
    const again = await send(author, 'admin.withdrawExclusion', { sanctionId }, { key });
    expect([again.status, again.replayed, again.body]).toEqual([200, 'true', withdrawn.body]);
    expect(await pendingIds()).not.toContain(sanctionId);
    expect(await eventsOf(author)).toEqual([
      expect.objectContaining({ type: 'SanctionPronounced' }),
      {
        command: 'admin.withdrawExclusion',
        type: 'ExclusionWithdrawn',
        payload: { sanctionId, userId: alice.user },
      },
    ]);

    const other = await moderator();
    for (const [command, code] of [
      ['admin.withdrawExclusion', 'EXCLUSION_WITHDRAWN'],
      ['admin.confirmExclusion', 'EXCLUSION_WITHDRAWN'],
      ['admin.liftSanction', 'SANCTION_ENDED'],
    ] as const)
      expect([command, ...codeOf(await send(other, command, { sanctionId }))]).toEqual([
        command,
        409,
        code,
      ]);
    // Jamais en vigueur : l'ordre reste ouvert, le séquestre aussi, et Alice joue.
    expect(await statusOf([placed.body.data.orderId as string])).toEqual(['open']);
    expect(await money(alice.houseId)).toEqual(before);
    expect((await buy(alice.user, world.kalliste, 3, 1)).status).toBe(200);
  });

  it('refuse une exclusion validée, une autre sanction ou un identifiant inconnu', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const sanctionId = await propose(alice.user);
    const other = await moderator();
    expect((await send(other, 'admin.confirmExclusion', { sanctionId })).status).toBe(200);
    const { sanctionId: silence } = await pronounce(alice.user, 'silence', 24);
    for (const [id, code] of [
      [sanctionId, 'ALREADY_CONFIRMED'],
      [silence, 'SANCTION_NOT_FOUND'],
      [randomUUID(), 'SANCTION_NOT_FOUND'],
    ] as const)
      expect(codeOf(await send(other, 'admin.withdrawExclusion', { sanctionId: id }))[1]).toBe(
        code,
      );
  });

  it('un retrait et une validation simultanés : l’un passe, l’autre voit son effet', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const orderId = (await buy(alice.user, world.kalliste, 4, 3)).body.data.orderId as string;
    const sanctionId = await propose(alice.user);
    const [m1, m2] = [await moderator(), await moderator()];
    const [withdrawn, confirmed] = await Promise.all([
      send(m1, 'admin.withdrawExclusion', { sanctionId }),
      send(m2, 'admin.confirmExclusion', { sanctionId }),
    ]);
    if (withdrawn.status === 200) {
      expect(codeOf(confirmed)).toEqual([409, 'EXCLUSION_WITHDRAWN']);
      expect(await statusOf([orderId])).toEqual(['open']);
    } else {
      expect(codeOf(withdrawn)).toEqual([409, 'ALREADY_CONFIRMED']);
      expect(confirmed.status).toBe(200);
      expect(await statusOf([orderId])).toEqual(['cancelled']);
    }
  });
});

describe('admin.liftSanction', () => {
  it('lève seule une suspension, que son auteur ou un autre compte lève ; le compte rejoue aussitôt', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const { author, sanctionId } = await pronounce(alice.user, 'suspension', 24);
    expect(codeOf(await buy(alice.user, world.kalliste, 2, 1))).toEqual([409, 'SUSPENDED']);
    await grant(alice.user, await (root ??= superAdmin()));
    expect(codeOf(await send(`aal2:${alice.user}`, 'admin.liftSanction', { sanctionId }))).toEqual([
      409,
      'SECOND_PERSON_REQUIRED',
    ]);

    const key = randomUUID();
    const lifted = await send(author, 'admin.liftSanction', { sanctionId }, { key });
    expect(lifted.status).toBe(200);
    expect(lifted.body.data).toEqual({
      sanctionId,
      pending: false,
      liftedAt: expect.any(String),
    });
    const again = await send(author, 'admin.liftSanction', { sanctionId }, { key });
    expect([again.status, again.replayed, again.body]).toEqual([200, 'true', lifted.body]);
    expect((await buy(alice.user, world.kalliste, 2, 1)).status).toBe(200);
    const [read] = await rows(sql<{ ends_at: Date }>`
      select ends_at from admin.sanctions where id = ${sanctionId}`);
    expect(read?.ends_at.toISOString()).toBe(lifted.body.data.liftedAt);
    expect((await eventsOf(author)).at(-1)).toEqual({
      command: 'admin.liftSanction',
      type: 'SanctionLifted',
      payload: { sanctionId, userId: alice.user, kind: 'suspension' },
    });
    expect(codeOf(await send(await moderator(), 'admin.liftSanction', { sanctionId }))).toEqual([
      409,
      'SANCTION_ENDED',
    ]);
  });

  it('refuse une sanction sous appel, une exclusion à valider, une sanction finie ou inconnue', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const { sanctionId: silence } = await pronounce(alice.user, 'silence', 24);
    expect(
      (await send(alice.user, 'moderation.appeal', { sanctionId: silence, body: 'Je conteste.' }))
        .status,
    ).toBe(200);
    const pending = await propose(alice.user);
    const [ended] = await rows(sql<{ id: string }>`
      insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id)
      values (${alice.user}, 'warning', now() - interval '2 days', now() - interval '1 day', 'Fini', ${idOf(await moderator())})
      returning id`);
    const other = await moderator();
    for (const [id, code] of [
      [silence, 'APPEAL_PENDING'],
      [pending, 'NOT_CONFIRMED'],
      [ended?.id, 'SANCTION_ENDED'],
      [randomUUID(), 'SANCTION_NOT_FOUND'],
    ] as const)
      expect([
        code,
        codeOf(await send(other, 'admin.liftSanction', { sanctionId: id }))[1],
      ]).toEqual([code, code]);
    // Accueillir l'appel lève la sanction, comme avant.
    const decided = await send(other, 'admin.decideAppeal', {
      sanctionId: silence,
      decision: 'granted',
    });
    expect(decided.body.data.liftedAt).not.toBeNull();
  });

  it('une exclusion validée se lève à deux, sans rouvrir les ordres ni toucher au séquestre', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const orderId = (await buy(alice.user, world.kalliste, 6, 5)).body.data.orderId as string;
    const sanctionId = await propose(alice.user);
    expect((await send(await moderator(), 'admin.confirmExclusion', { sanctionId })).status).toBe(
      200,
    );
    const afterExclusion = await money(alice.houseId);
    expect(afterExclusion.escrow).toBe(0);
    const entries = await entriesOf(world.worldId);

    const [first, second] = [await moderator(), await moderator()];
    const proposed = await send(first, 'admin.liftSanction', { sanctionId });
    expect(proposed.body.data).toEqual({ sanctionId, pending: true, liftedAt: null });
    // Proposée, la levée n'agit pas, et qui l'a proposée ne la confirme pas.
    expect(codeOf(await buy(alice.user, world.kalliste, 2, 1))).toEqual([409, 'SUSPENDED']);
    expect(codeOf(await send(first, 'admin.liftSanction', { sanctionId }))).toEqual([
      409,
      'SECOND_PERSON_REQUIRED',
    ]);
    const lifted = await send(second, 'admin.liftSanction', { sanctionId });
    expect(lifted.body.data).toEqual({ sanctionId, pending: false, liftedAt: expect.any(String) });
    expect(await eventsOf(first)).toEqual([
      {
        command: 'admin.liftSanction',
        type: 'SanctionLiftProposed',
        payload: { sanctionId, userId: alice.user },
      },
    ]);

    // L'ordre annulé à la validation le reste, et la levée n'a rien écrit au grand livre.
    expect(await statusOf([orderId])).toEqual(['cancelled']);
    expect(await money(alice.houseId)).toEqual(afterExclusion);
    expect(await entriesOf(world.worldId)).toBe(entries);
    expect(
      await rows(sql`select e.type from game.domain_events e join game.command_log l on l.id = e.command_id
        where l.user_id = ${idOf(second)}`),
    ).toEqual([{ type: 'SanctionLifted' }]);
    // Levée, l'exclusion n'agit plus : Alice rejoue, avec ce que sa maison a gardé.
    expect((await buy(alice.user, world.kalliste, 2, 1)).status).toBe(200);
    expect(codeOf(await send(await moderator(), 'admin.liftSanction', { sanctionId }))).toEqual([
      409,
      'SANCTION_ENDED',
    ]);
  });

  it('deux propositions simultanées : de deux personnes, elles lèvent ; d’une seule, non', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    const confirmed = async (user: string) => {
      const sanctionId = await propose(user);
      expect((await send(await moderator(), 'admin.confirmExclusion', { sanctionId })).status).toBe(
        200,
      );
      return sanctionId;
    };
    const [forAlice, forBob] = [await confirmed(alice.user), await confirmed(bob.user)];
    const [m1, m2] = [await moderator(), await moderator()];
    const two = await Promise.all([
      send(m1, 'admin.liftSanction', { sanctionId: forAlice }),
      send(m2, 'admin.liftSanction', { sanctionId: forAlice }),
    ]);
    expect(two.map((reply) => reply.body.data?.pending).sort()).toEqual([false, true]);
    const one = await Promise.all([
      send(m1, 'admin.liftSanction', { sanctionId: forBob }),
      send(m1, 'admin.liftSanction', { sanctionId: forBob }),
    ]);
    expect(one.map((reply) => reply.body.data?.pending ?? reply.body.error?.code).sort()).toEqual([
      'SECOND_PERSON_REQUIRED',
      true,
    ]);
    expect(
      await rows(sql<{ lifted: boolean }>`
        select lifted_at is not null as lifted from admin.sanctions
        where id in (${forAlice}, ${forBob}) order by id = ${forAlice} desc`),
    ).toEqual([{ lifted: true }, { lifted: false }]);
  });

  it('une levée datée après le début de la commande ne se réécrit pas : ni appel, ni nouvelle levée (#616)', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const [author, lifter, other] = [await moderator(), await moderator(), await moderator()];
    // Levée écrite par une transaction commencée après la commande : son instant suit le `now()` de celle-ci. Posée
    // par le propriétaire, garde coupée le temps de l'insertion, dans une transaction qui la rétablit.
    const lifted = (appealed: boolean) =>
      owner.transaction().execute(async (trx) => {
        await sql`alter table admin.sanctions disable trigger sanctions_guard`.execute(trx);
        const {
          rows: [row],
        } = await sql<{ id: string; lifted_at: Date }>`
          insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id, lifted_by, lifted_at,
                                       appeal_body, appealed_at)
          values (${alice.user}, 'suspension', now() - interval '1 hour', now() + interval '1 hour', 'Course',
                  ${idOf(author)}, ${idOf(lifter)}, now() + interval '1 hour',
                  ${appealed ? 'Je conteste.' : null}, ${appealed ? sql`now()` : null})
          returning id, lifted_at`.execute(trx);
        await sql`alter table admin.sanctions enable trigger sanctions_guard`.execute(trx);
        if (!row) throw new Error('No sanction');
        return row;
      });
    const [appealed, alone] = [await lifted(true), await lifted(false)];
    const granted = await send(other, 'admin.decideAppeal', {
      sanctionId: appealed.id,
      decision: 'granted',
    });
    expect(granted.status).toBe(200);
    expect(granted.body.data.liftedAt).toBe(appealed.lifted_at.toISOString());
    expect(
      await rows(
        sql<{ lifted_by: string }>`select lifted_by from admin.sanctions where id = ${appealed.id}`,
      ),
    ).toEqual([{ lifted_by: idOf(lifter) }]);
    expect(
      codeOf(await send(alice.user, 'moderation.appeal', { sanctionId: alone.id, body: 'Tard' })),
    ).toEqual([409, 'SANCTION_ENDED']);
    expect(codeOf(await send(other, 'admin.liftSanction', { sanctionId: alone.id }))).toEqual([
      409,
      'SANCTION_ENDED',
    ]);
  });
});

describe('GET /api/admin/reports : levées proposées (#616)', () => {
  const app = appWith(testConfig);
  const lifts = async (token: string) => {
    const res = await app.request('/api/admin/reports', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return adminReportsSchema.parse(((await res.json()) as { data: unknown }).data).pendingLifts;
  };

  it('liste les levées à confirmer, sans appel qui attend, et une seconde personne les confirme de là', async () => {
    const world = await newWorld();
    const [alice, bob, chloe, dora] = [
      await world.player(),
      await world.player(),
      await world.player(),
      await world.player(),
    ];
    const validator = await moderator();
    const confirmed = async (user: string) => {
      const sanctionId = await propose(user);
      expect((await send(validator, 'admin.confirmExclusion', { sanctionId })).status).toBe(200);
      return sanctionId;
    };
    const [forAlice, forBob, forChloe, forDora] = [
      await confirmed(alice.user),
      await confirmed(bob.user),
      await confirmed(chloe.user),
      await confirmed(dora.user),
    ];
    const [proposer, other] = [await moderator(), await moderator()];
    // Dora : exclusion validée sans proposition, jamais listée.
    for (const sanctionId of [forAlice, forBob, forChloe])
      expect((await send(proposer, 'admin.liftSanction', { sanctionId })).body.data.pending).toBe(
        true,
      );
    expect(
      (await send(bob.user, 'moderation.appeal', { sanctionId: forBob, body: 'Je conteste.' }))
        .status,
    ).toBe(200);
    // Chloé : son appel, fait après la proposition, est rejeté ; la levée proposée revient dans la file.
    expect(
      (await send(chloe.user, 'moderation.appeal', { sanctionId: forChloe, body: 'Je conteste.' }))
        .status,
    ).toBe(200);
    const rejected = await send(other, 'admin.decideAppeal', {
      sanctionId: forChloe,
      decision: 'rejected',
    });
    expect(rejected.body.data).toMatchObject({ decision: 'rejected', liftedAt: null });

    const listed = (await lifts(other)).filter((lift) =>
      [forAlice, forBob, forChloe, forDora].includes(lift.sanctionId),
    );
    const lift = (sanctionId: string, userId: string) => ({
      sanctionId,
      userId,
      reason: 'Triche avérée',
      authorId: expect.any(String),
      confirmedBy: idOf(validator),
      startsAt: expect.any(String),
      proposedBy: idOf(proposer),
      proposedAt: expect.any(String),
    });
    expect(listed).toEqual([lift(forAlice, alice.user), lift(forChloe, chloe.user)]);
    // Sans connaître l'identifiant : la seconde personne le lit dans la file.
    const [entry] = listed;
    expect(
      codeOf(await send(proposer, 'admin.liftSanction', { sanctionId: entry?.sanctionId })),
    ).toEqual([409, 'SECOND_PERSON_REQUIRED']);
    const lifted = await send(other, 'admin.liftSanction', { sanctionId: entry?.sanctionId });
    expect(lifted.body.data).toMatchObject({ sanctionId: forAlice, pending: false });
    expect((await lifts(other)).some((lift) => lift.sanctionId === forAlice)).toBe(false);
  });

  const active = async (token: string) => {
    const res = await app.request('/api/admin/reports', {
      headers: { authorization: `Bearer ${token}` },
    });
    return adminReportsSchema.parse(((await res.json()) as { data: unknown }).data)
      .activeExclusions;
  };

  it('liste les exclusions en vigueur : pas celles dont l’appel attend, ni dont la levée est proposée (#636)', async () => {
    const world = await newWorld();
    const [alice, bob, chloe, dora] = [
      await world.player(),
      await world.player(),
      await world.player(),
      await world.player(),
    ];
    const validator = await moderator();
    const confirmed = async (user: string) => {
      const sanctionId = await propose(user);
      expect((await send(validator, 'admin.confirmExclusion', { sanctionId })).status).toBe(200);
      return sanctionId;
    };
    const [forAlice, forBob, forChloe] = [
      await confirmed(alice.user),
      await confirmed(bob.user),
      await confirmed(chloe.user),
    ];
    // Dora : exclusion seulement proposée, jamais listée.
    const forDora = await propose(dora.user);
    const [proposer, other] = [await moderator(), await moderator()];
    expect(
      (await send(bob.user, 'moderation.appeal', { sanctionId: forBob, body: 'Je conteste.' }))
        .status,
    ).toBe(200);
    const mine = async () =>
      (await active(other)).filter((item) =>
        [forAlice, forBob, forChloe, forDora].includes(item.sanctionId),
      );
    expect((await mine()).map((item) => item.sanctionId)).toEqual([forAlice, forChloe]);
    expect((await mine())[0]).toEqual({
      sanctionId: forAlice,
      userId: alice.user,
      reason: 'Triche avérée',
      authorId: expect.any(String),
      confirmedBy: idOf(validator),
      startsAt: expect.any(String),
    });
    // La levée proposée passe dans « levées à confirmer » : elle quitte la liste.
    expect(
      (await send(proposer, 'admin.liftSanction', { sanctionId: forChloe })).body.data.pending,
    ).toBe(true);
    expect((await mine()).map((item) => item.sanctionId)).toEqual([forAlice]);
    // Appel accueilli : l'exclusion est levée, elle quitte aussi la liste.
    expect(
      (await send(other, 'admin.decideAppeal', { sanctionId: forBob, decision: 'granted' })).status,
    ).toBe(200);
    expect(await send(other, 'admin.liftSanction', { sanctionId: forAlice })).toMatchObject({
      status: 200,
    });
    expect((await send(validator, 'admin.liftSanction', { sanctionId: forAlice })).status).toBe(
      200,
    );
    expect(await mine()).toEqual([]);
  });
});
