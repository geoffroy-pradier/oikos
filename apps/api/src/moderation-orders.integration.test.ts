import { randomUUID } from 'node:crypto';
import type { AdminRole } from '@oikos/contracts';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { codeOf, db, newWorld, owner, rows, send } from './chat-test-world';

// Ordres de marché d'un compte suspendu ou exclu (#528), contre Supabase local : l'annulation reste permise sous
// sanction. Les comptes de l'équipe sont inscrits par le test ; leurs rôles sont retirés à la fin.
const staff: string[] = [];
afterAll(async () => {
  await sql`delete from admin.roles where user_id = any(${staff}::uuid[])`.execute(owner);
  await Promise.all([db.destroy(), owner.destroy()]);
});
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
/** Un compte de la modération, à second facteur. */
const moderator = async () =>
  `aal2:${await account('moderator', await (root ??= account('super_admin', null)))}`;

interface Player {
  user: string;
  houseId: string;
}
/** Du blé dans le stock de la maison, par le journal des stocks (récolte simulée). */
async function give(worldId: string, cityId: string, player: Player, quantity: number) {
  await sql`insert into game.inventories (world_id, house_id, city_id, good_id)
    values (${worldId}, ${player.houseId}, ${cityId}, 'wheat') on conflict on constraint inventories_unique do nothing`.execute(
    owner,
  );
  await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
    select ${worldId}, 'wheat', ${quantity}, 'production', id, 'test.seed' from game.inventories
    where house_id = ${player.houseId} and city_id = ${cityId} and good_id = 'wheat'`.execute(
    owner,
  );
}
const order = async (
  player: Player,
  cityId: string,
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
) => send(player.user, 'market.placeOrder', { cityId, goodId: 'wheat', side, price, quantity });
const placed = async (reply: ReturnType<typeof order>) => {
  const answer = await reply;
  if (answer.status !== 200) throw new Error(`placeOrder: ${JSON.stringify(answer.body)}`);
  return answer.body.data.orderId as string;
};
/** Trésorerie et séquestre d'une maison, en oboles. */
async function money(houseId: string) {
  const found = await rows(sql<{ kind: string; balance: string }>`
    select kind, balance from game.accounts where house_id = ${houseId}`);
  const of = (kind: string) => Number(found.find((row) => row.kind === kind)?.balance ?? 0);
  return { treasury: of('house'), escrow: of('escrow') };
}
const reservedOf = async (houseId: string) =>
  Number(
    (
      await rows(sql<{ n: string }>`
        select coalesce(sum(reserved), 0) as n from game.inventories where house_id = ${houseId}`)
    )[0]?.n,
  );
const statusOf = async (ids: string[]) =>
  (
    await rows(sql<{ status: string }>`
      select status from game.orders where id = any(${ids}::uuid[]) order by array_position(${ids}::uuid[], id)`)
  ).map((row) => row.status);
/** Écritures des mondes dont les lignes ne s'annulent pas : aucune ne doit l'être. */
const unbalanced = async (worldIds: string[]) =>
  rows(sql<{ id: string }>`
    select e.id from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
    where e.world_id = any(${worldIds}::uuid[]) group by e.id having sum(l.amount) <> 0`);
describe('market.cancelOrder sous sanction (#528)', () => {
  it('un compte suspendu annule ses ordres, séquestre rendu et réservation levée ; toute autre commande reste refusée', async () => {
    const world = await newWorld();
    const [alice, bob] = [await world.player(), await world.player()];
    await give(world.worldId, world.kalliste, alice, 10);
    const start = await money(alice.houseId);
    const buy = await placed(order(alice, world.kalliste, 'buy', 7, 6));
    const sell = await placed(order(alice, world.kalliste, 'sell', 30, 4));
    expect(await money(alice.houseId)).toEqual({ treasury: start.treasury - 42, escrow: 42 });
    await sql`insert into admin.sanctions (user_id, kind, ends_at, reason, author_id)
      values (${alice.user}, 'suspension', now() + interval '1 hour', 'Essai', ${(await moderator()).slice(5)})`.execute(
      owner,
    );

    for (const reply of [
      await order(alice, world.kalliste, 'buy', 7, 1),
      await send(alice.user, 'house.rename', { name: 'Suspendus' }),
      await send(alice.user, 'chat.post', { channelId: world.kallisteChannel, body: 'Bonjour' }),
    ])
      expect(codeOf(reply)).toEqual([409, 'SUSPENDED']);
    const cancelled = await send(alice.user, 'market.cancelOrder', { orderId: buy });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toEqual({ orderId: buy, status: 'cancelled', released: 6 });
    expect((await send(alice.user, 'market.cancelOrder', { orderId: sell })).status).toBe(200);
    expect(await money(alice.houseId)).toEqual(start);
    expect(await reservedOf(alice.houseId)).toBe(0);
    // Ni l'ordre d'un autre, ni un ordre déjà annulé : les refus de la commande sont inchangés.
    const bobs = await placed(order(bob, world.kalliste, 'buy', 5, 1));
    expect(codeOf(await send(alice.user, 'market.cancelOrder', { orderId: bobs }))).toEqual([
      404,
      'ORDER_NOT_FOUND',
    ]);
    expect(codeOf(await send(alice.user, 'market.cancelOrder', { orderId: buy }))).toEqual([
      409,
      'ORDER_NOT_OPEN',
    ]);
    expect(await statusOf([buy, sell, bobs])).toEqual(['cancelled', 'cancelled', 'open']);
    expect(await unbalanced([world.worldId])).toEqual([]);
  });
});
