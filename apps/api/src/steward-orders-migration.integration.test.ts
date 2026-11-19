import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { db, newWorld, owner, rows, send } from './chat-test-world';

// Rattachement, par la migration 480, des ordres ouverts posés par un intendant avant elle (#562), contre Supabase
// local : la migration est rejouée comme par un déploiement, sur un monde où un intendant a un achat et une vente au
// carnet, que le journal des commandes nomme sans que l'ordre porte encore son intendant.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const MIGRATION = new URL(
  '../../../packages/db/supabase/migrations/20261118000480_steward_orders.sql',
  import.meta.url,
);

describe('migration 480 : ordres posés avant elle par un intendant (#562)', () => {
  it('rattache à leur intendant un achat et une vente ouverts que le journal nomme, et rien d’autre', async () => {
    const world = await newWorld();
    const player = await world.player();
    const mill = await send(player.user, 'site.acquire', { recipeId: 'mill_flour' });
    const siteId = mill.body.data.siteId as string;
    const hired = await send(player.user, 'steward.hire', { siteId });
    const steward = hired.body.data.stewardId as string;
    const rule = { kind: 'sell', goodId: 'wheat', minPriceOboles: 900, keepUnits: 0 };
    expect(
      (await send(player.user, 'steward.setRules', { stewardId: steward, rules: [rule] })).status,
    ).toBe(200);
    await sql`update game.stewards set unpaid_since = null where id = ${steward}`.execute(owner);
    await sql`insert into game.inventories (world_id, house_id, city_id, good_id)
      values (${world.worldId}, ${player.houseId}, ${world.kalliste}, 'wheat')`.execute(owner);
    await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
      select ${world.worldId}, 'wheat', 4, 'production', id, 'test.seed' from game.inventories
      where house_id = ${player.houseId} and good_id = 'wheat'`.execute(owner);
    const order = async (side: 'buy' | 'sell', price: number, quantity: number) => {
      const input = { cityId: world.kalliste, goodId: 'wheat', side, price, quantity };
      const reply = await send(player.user, 'market.placeOrder', input);
      expect(reply.body.data).toMatchObject({ status: 'open' });
      return reply.body.data.orderId as string;
    };
    const [buy, sell, own] = [
      await order('buy', 2, 5),
      await order('sell', 900, 4),
      await order('buy', 1, 3),
    ];
    // Posés par la commande, les ordres ne nomment aucun intendant. Pour les deux premiers, l'opération de
    // l'intendant, comme le moteur l'inscrivait avant la migration : son journal et sa trace. Le troisième reste au
    // joueur.
    const tick = 9_200_000_000 + Math.floor(Math.random() * 1_000_000);
    for (const [rank, orderId] of [buy, sell].entries()) {
      const commandId = randomUUID();
      await sql`insert into game.command_log (id, user_id, command, idempotency_key, input, status, response, duration_ms, steward_id)
        values (${commandId}, ${player.user}, 'market.placeOrder', ${`steward:${steward}:${tick}:${rank}`}, '{}', 'ok',
          ${JSON.stringify({ ok: true, data: { orderId, status: 'open' } })}, 0, ${steward})`.execute(
        owner,
      );
      await sql`insert into game.steward_operations (world_id, steward_id, tick_index, rank, rules_revision, rule_position, status, summary, command_id)
        values (${world.worldId}, ${steward}, ${tick}, ${rank}, 1, 0, 'ok', '{"command": "market.placeOrder"}', ${commandId})`.execute(
        owner,
      );
    }
    const money = () =>
      rows(sql<{ kind: string; balance: string }>`
        select kind, balance from game.accounts where house_id = ${player.houseId} order by kind`);
    const before = await money();

    // Comme un déploiement : le fichier, en une transaction.
    const migration = readFileSync(MIGRATION, 'utf8');
    await owner.transaction().execute((trx) => sql.raw(migration).execute(trx));

    expect(
      await rows(sql<{ id: string; steward_id: string | null }>`
        select id, steward_id from game.orders where house_id = ${player.houseId} order by seq`),
    ).toEqual([
      { id: buy, steward_id: steward },
      { id: sell, steward_id: steward },
      { id: own, steward_id: null },
    ]);
    // Le séquestre et la réservation n'ont pas bougé ; la garde des ordres est rétablie.
    expect(await money()).toEqual(before);
    expect(
      await rows(
        sql`select quantity::int, reserved::int from game.inventories where house_id = ${player.houseId}`,
      ),
    ).toEqual([{ quantity: 4, reserved: 4 }]);
    expect(await rows(sql`select tgenabled from pg_trigger where tgname = 'orders_guard'`)).toEqual(
      [{ tgenabled: 'O' }],
    );
  });
});
