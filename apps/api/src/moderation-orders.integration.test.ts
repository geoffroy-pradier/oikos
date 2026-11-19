import { randomUUID } from 'node:crypto';
import type { AdminRole } from '@oikos/contracts';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { codeOf, db, newWorld, owner, rows, send } from './chat-test-world';

// Ordres de marché d'un compte suspendu ou exclu (#528), contre Supabase local : l'annulation reste permise sous
// sanction, et la validation d'une exclusion annule les ordres ouverts de ses maisons, séquestre rendu au grand
// livre. Les comptes de l'équipe sont inscrits par le test ; leurs rôles sont retirés à la fin.
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
/** Monnaie des mondes, comptes système compris : la partie double la garde constante. */
const totalOf = async (worldIds: string[]) =>
  Number(
    (
      await rows(sql<{ n: string }>`
        select coalesce(sum(balance), 0) as n from game.accounts where world_id = any(${worldIds}::uuid[])`)
    )[0]?.n,
  );
/** Écritures des mondes dont les lignes ne s'annulent pas : aucune ne doit l'être. */
const unbalanced = async (worldIds: string[]) =>
  rows(sql<{ id: string }>`
    select e.id from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
    where e.world_id = any(${worldIds}::uuid[]) group by e.id having sum(l.amount) <> 0`);
/** Propose l'exclusion de `user` par un modérateur ; un autre la validera. */
async function propose(user: string) {
  const proposed = await send(await moderator(), 'admin.sanction', {
    userId: user,
    kind: 'ban',
    reason: 'Triche avérée',
  });
  expect(proposed.status).toBe(200);
  return proposed.body.data.sanctionId as string;
}

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

describe('validation d’une exclusion (#528)', () => {
  it('annule les ordres ouverts de sa maison, rend le séquestre par le grand livre, dans la même transaction', async () => {
    const [w1, w2] = [await newWorld(), await newWorld()];
    const alice = await w1.player();
    const [bob, chloe] = [await w1.player(), await w2.player()];
    await give(w1.worldId, w1.kalliste, alice, 9);
    await give(w1.worldId, w1.kalliste, bob, 2);
    const partial = await placed(order(alice, w1.kalliste, 'buy', 5, 4));
    // Bob sert 2 unités de l'achat à 5 : le reste (2) attend, seul son séquestre est rendu.
    expect((await order(bob, w1.kalliste, 'sell', 5, 2)).status).toBe(200);
    const sell = await placed(order(alice, w1.kalliste, 'sell', 40, 9));
    const elsewhere = await placed(order(alice, w1.elaia, 'buy', 2, 1));
    // Un compte n'a qu'une maison dans tout le jeu (#604) : l'autre monde n'a que la maison de Chloé.
    const bobs = await placed(order(bob, w1.kalliste, 'buy', 4, 1));
    const chloes = await placed(order(chloe, w2.kalliste, 'buy', 1, 1));

    const sanctionId = await propose(alice.user);
    // Proposée, l'exclusion n'agit pas : les ordres restent ouverts.
    expect(await statusOf([partial, sell, elsewhere])).toEqual(Array(3).fill('open'));
    const before = {
      here: await money(alice.houseId),
      bob: await money(bob.houseId),
      chloe: await money(chloe.houseId),
      total: await totalOf([w1.worldId, w2.worldId]),
    };
    expect(before.here.escrow).toBe(2 * 5 + 2);
    expect(await reservedOf(alice.houseId)).toBe(9);

    const validator = await moderator();
    const confirmed = await send(validator, 'admin.confirmExclusion', { sanctionId });
    expect(confirmed.status).toBe(200);
    // La réponse, que lit un modérateur, ne dit rien de l'économie du compte exclu (15.4).
    expect(Object.keys(confirmed.body.data).sort()).toEqual(['sanctionId', 'startsAt']);

    expect(await statusOf([partial, sell, elsewhere, bobs, chloes])).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
      'open',
      'open',
    ]);
    // Le reste servi l'est resté : 2 unités ont été achetées à l'ordre partiel avant l'exclusion.
    expect(await rows(sql`select remaining::int from game.orders where id = ${partial}`)).toEqual([
      { remaining: 2 },
    ]);
    expect(await money(alice.houseId)).toEqual({
      treasury: before.here.treasury + before.here.escrow,
      escrow: 0,
    });
    expect(await reservedOf(alice.houseId)).toBe(0);
    // Le stock reste à la maison : sa saisie est hors de ce ticket.
    expect(
      await rows(
        sql`select quantity::int from game.inventories where house_id = ${alice.houseId} and city_id = ${w1.kalliste}`,
      ),
    ).toEqual([{ quantity: 11 }]);
    expect(await money(bob.houseId)).toEqual(before.bob);
    expect(await money(chloe.houseId)).toEqual(before.chloe);
    expect(await totalOf([w1.worldId, w2.worldId])).toBe(before.total);
    expect(await unbalanced([w1.worldId, w2.worldId])).toEqual([]);

    // Une écriture de retour, de son séquestre à sa trésorerie, inscrite par la commande.
    const releases = await rows(sql<{ world_id: string; lines: number[] }>`
      select e.world_id, array_agg(l.amount::int order by l.amount) as lines
      from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
      where e.kind = 'market.escrow_release' and e.meta->>'cause' = 'exclusion'
        and e.world_id in (${w1.worldId}, ${w2.worldId})
      group by e.id, e.world_id order by e.world_id = ${w1.worldId} desc`);
    expect(releases).toEqual([{ world_id: w1.worldId, lines: [-12, 12] }]);
    // Chaque ordre annulé l'est aussi dans les événements, avec la validation, sous la même commande.
    const events = await rows(sql<{ type: string; order_id: string | null }>`
      select e.type, e.payload->>'orderId' as order_id from game.domain_events e
      join game.command_log l on l.id = e.command_id
      where l.user_id = ${validator.slice(5)} and l.command = 'admin.confirmExclusion' order by e.type, e.payload->>'orderId' collate "C"`);
    expect(events).toEqual([
      { type: 'ExclusionConfirmed', order_id: null },
      ...[partial, sell, elsewhere].sort().map((id) => ({ type: 'OrderCancelled', order_id: id })),
    ]);

    // Exclue, Alice ne place plus rien ; l'annulation lui reste permise, et ne trouve plus d'ordre ouvert.
    expect(codeOf(await order(alice, w1.kalliste, 'buy', 1, 1))).toEqual([409, 'SUSPENDED']);
    expect(codeOf(await send(alice.user, 'market.cancelOrder', { orderId: partial }))).toEqual([
      409,
      'ORDER_NOT_OPEN',
    ]);
  });

  it('rejouée ou validée deux fois en même temps, elle ne rend le séquestre qu’une fois', async () => {
    const world = await newWorld();
    const alice = await world.player();
    await placed(order(alice, world.kalliste, 'buy', 6, 5));
    const start = await money(alice.houseId);
    const sanctionId = await propose(alice.user);
    const [m1, m2] = [await moderator(), await moderator()];
    const key = randomUUID();
    const replies = await Promise.all([
      send(m1, 'admin.confirmExclusion', { sanctionId }, { key }),
      send(m2, 'admin.confirmExclusion', { sanctionId }),
    ]);
    expect(replies.map(codeOf).sort()).toEqual([
      [200, undefined],
      [409, 'ALREADY_CONFIRMED'],
    ]);
    // Le rejeu rend la réponse déjà validée sous sa clé, acceptée ou refusée, sans rien exécuter.
    const again = await send(m1, 'admin.confirmExclusion', { sanctionId }, { key });
    expect([again.status, again.replayed, again.body]).toEqual([
      replies[0]?.status,
      'true',
      replies[0]?.body,
    ]);
    expect(await money(alice.houseId)).toEqual({
      treasury: start.treasury + start.escrow,
      escrow: 0,
    });
    const [{ n } = { n: -1 }] = await rows(sql<{ n: number }>`
      select count(*)::int as n from game.ledger_entries
      where world_id = ${world.worldId} and meta->>'cause' = 'exclusion'`);
    expect(n).toBe(1);
  });

  /**
   * Un ordre d'Alice, déjà passé au contrôle des sanctions du registre (l'exclusion n'est pas encore validée), et la
   * validation de son exclusion attendent ensemble le verrou d'agora, que le test tient ; `validationFirst` dit qui
   * est en file le premier. Rend les deux réponses et ce qu'il faut vérifier ensuite.
   */
  async function race(validationFirst: boolean) {
    const world = await newWorld();
    const alice = await world.player();
    const first = await placed(order(alice, world.kalliste, 'buy', 4, 2));
    const start = await money(alice.houseId);
    const sanctionId = await propose(alice.user);
    const validator = await moderator();
    const agora = `market:${world.worldId}`;
    /** Attend que `n` transactions attendent le verrou d'agora du monde. */
    const queued = async (n: number) => {
      for (let tries = 0; tries < 300; tries += 1) {
        const [{ waiting } = { waiting: 0 }] = await rows(sql<{ waiting: number }>`
          select count(*)::int as waiting from pg_locks, hashtextextended(${agora}, 0) as k
          where locktype = 'advisory' and not granted
            and classid::bigint = (k >> 32) & 4294967295 and objid::bigint = k & 4294967295`);
        if (waiting >= n) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`${n} transactions never queued for ${agora}`);
    };
    const late = () => order(alice, world.kalliste, 'buy', 3, 5);
    const confirm = () => send(validator, 'admin.confirmExclusion', { sanctionId });
    const replies = await owner.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${agora}, 0))`.execute(trx);
      const [one, two] = validationFirst ? [confirm, late] : [late, confirm];
      const firstReply = one();
      await queued(1);
      const secondReply = two();
      await queued(2);
      return validationFirst
        ? { confirmed: firstReply, late: secondReply }
        : { late: firstReply, confirmed: secondReply };
    });
    return {
      alice,
      first,
      start,
      late: await replies.late,
      confirmed: await replies.confirmed,
    };
  }

  it('un ordre en file avant la validation est annulé avec les autres, jamais laissé ouvert', async () => {
    // Sans le verrou d'agora de la validation, elle validerait sans voir l'ordre, qui resterait ouvert.
    const { alice, first, start, late, confirmed } = await race(false);
    expect(late.status).toBe(200);
    expect(confirmed.status).toBe(200);
    expect(await statusOf([first, late.body.data.orderId as string])).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(await money(alice.houseId)).toEqual({
      treasury: start.treasury + start.escrow,
      escrow: 0,
    });
  });

  it('un ordre en file après la validation est refusé : la sanction est relue sous le verrou d’agora', async () => {
    // Le registre a lu la sanction au début de la transaction, avant la validation : seule la relecture de
    // `placeOrder`, sous le verrou, voit l'exclusion validée pendant l'attente.
    const { alice, first, start, late, confirmed } = await race(true);
    expect(confirmed.status).toBe(200);
    expect(codeOf(late)).toEqual([409, 'SUSPENDED']);
    expect(
      await rows(sql`select id, status from game.orders where house_id = ${alice.houseId}`),
    ).toEqual([{ id: first, status: 'cancelled' }]);
    expect(await money(alice.houseId)).toEqual({
      treasury: start.treasury + start.escrow,
      escrow: 0,
    });
    const [logged] = await rows(sql<{ status: string; error_code: string }>`
      select status, error_code from game.command_log
      where user_id = ${alice.user} and command = 'market.placeOrder' order by created_at desc limit 1`);
    expect(logged).toEqual({ status: 'rejected', error_code: 'SUSPENDED' });
  });

  it('une maison sans ordre ouvert, ou un compte sans maison : la validation passe sans écriture', async () => {
    const world = await newWorld();
    const alice = await world.player();
    const nobody = randomUUID();
    await sql`insert into auth.users (id, email) values (${nobody}, ${`${nobody}@example.test`})`.execute(
      owner,
    );
    for (const user of [alice.user, nobody])
      expect(
        (
          await send(await moderator(), 'admin.confirmExclusion', {
            sanctionId: await propose(user),
          })
        ).status,
      ).toBe(200);
    expect(
      await rows(sql`select count(*)::int as n from game.ledger_entries
        where world_id = ${world.worldId} and kind = 'market.escrow_release'`),
    ).toEqual([{ n: 0 }]);
  });

  it('en même temps que ses annulations, des achats et des ventes d’autres maisons : ni interblocage, ni séquestre rendu deux fois', async () => {
    for (let round = 0; round < 3; round += 1) {
      const world = await newWorld();
      const alice = await world.player();
      const [bob, chloe] = [await world.player(), await world.player()];
      const start = await money(alice.houseId);
      await give(world.worldId, world.kalliste, alice, 6);
      await give(world.worldId, world.kalliste, bob, 6);
      const buys = [
        await placed(order(alice, world.kalliste, 'buy', 8, 3)),
        await placed(order(alice, world.kalliste, 'buy', 7, 3)),
        await placed(order(alice, world.elaia, 'buy', 9, 2)),
      ];
      const sells = [
        await placed(order(alice, world.kalliste, 'sell', 20, 3)),
        await placed(order(alice, world.kalliste, 'sell', 21, 3)),
      ];
      const total = await totalOf([world.worldId]);
      const sanctionId = await propose(alice.user);
      const validator = await moderator();
      const replies = await Promise.all([
        send(validator, 'admin.confirmExclusion', { sanctionId }),
        ...[buys[0], sells[1], buys[2]].map((orderId) =>
          send(alice.user, 'market.cancelOrder', { orderId }),
        ),
        // Bob vend dans les achats d'Alice, Chloé achète ses ventes : ils prennent le verrou d'agora.
        order(bob, world.kalliste, 'sell', 7, 4),
        order(chloe, world.kalliste, 'buy', 21, 4),
      ]);
      expect(replies[0]?.status).toBe(200);
      for (const reply of replies.slice(1, 4))
        expect([
          [200, undefined],
          [409, 'ORDER_NOT_OPEN'],
        ]).toContainEqual(codeOf(reply));
      for (const reply of replies.slice(4)) expect(reply.status).toBe(200);
      // Plus rien d'ouvert chez Alice : servi avant, annulé par elle ou par l'exclusion.
      expect((await statusOf([...buys, ...sells])).every((status) => status !== 'open')).toBe(true);
      expect(await money(alice.houseId)).toMatchObject({ escrow: 0 });
      expect(await reservedOf(alice.houseId)).toBe(0);
      expect(await totalOf([world.worldId])).toBe(total);
      expect(await unbalanced([world.worldId])).toEqual([]);
      // Ce qu'Alice a acheté a été payé par son séquestre, le reste lui est revenu : sa monnaie (trésorerie et
      // séquestre) a baissé de ce qu'elle a payé, et monté du net de ses ventes.
      const [flows] = await rows(sql<{ paid: string; earned: string }>`
        select
          coalesce(sum(t.price * t.quantity) filter (where b.house_id = ${alice.houseId}), 0) as paid,
          coalesce(sum(l.amount) filter (where s.house_id = ${alice.houseId}), 0) as earned
        from game.trades t
        join game.orders b on b.id = t.buy_order_id join game.orders s on s.id = t.sell_order_id
        left join game.ledger_lines l on l.entry_id = t.ledger_entry_id
          and l.account_id = (select id from game.accounts where house_id = ${alice.houseId} and kind = 'house')
        where t.world_id = ${world.worldId}`);
      const after = await money(alice.houseId);
      expect(after.treasury + after.escrow).toBe(
        start.treasury + start.escrow - Number(flows?.paid) + Number(flows?.earned),
      );
    }
  });
});
