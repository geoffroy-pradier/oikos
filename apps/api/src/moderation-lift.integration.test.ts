import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { codeOf, db, newWorld, owner, rows, send } from './chat-test-world';

// Retrait d'une exclusion proposée (#531), contre Supabase local. Les comptes de l'équipe sont inscrits par le
// test ; leurs rôles sont retirés à la fin.
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
