import type { DomainEvent } from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

/** Verrou d'agora d'un monde : celui de toute pose, exécution ou annulation d'ordre qui doit suivre les autres. */
export const lockAgora = (trx: Db, worldId: string) =>
  sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(trx);

/** Un ordre ouvert lu et verrouillé (`FOR UPDATE`) par l'appelant, sous le verrou d'agora de son monde. */
export interface OpenOrder {
  id: string;
  world_id: string;
  house_id: string;
  city_id: string;
  good_id: string;
  side: 'buy' | 'sell';
  price: string;
  remaining: string;
}

/**
 * Annule des ordres ouverts que l'appelant a verrouillés, chacun comme par `market.cancelOrder` : le reste seul (ce
 * qui a été servi reste acquis). La base lève la réservation d'une vente (déclencheur des ordres) ; le séquestre des
 * achats revient à la trésorerie de leur maison, en une écriture `market.escrow_release` par maison au grand livre,
 * marquée de `meta(houseId)`. Les trésoreries sont verrouillées dans l'ordre des maisons, après les ordres : l'ordre
 * de `market.cancelOrder` (ordre, puis trésorerie). Montants comptés en entiers exacts ; un séquestre nul n'écrit rien.
 */
export async function cancelLockedOrders(
  trx: Db,
  orders: readonly OpenOrder[],
  emit: (event: DomainEvent) => void,
  meta: (houseId: string) => Record<string, unknown>,
): Promise<void> {
  if (orders.length === 0) return;
  const escrowByHouse = new Map<string, { worldId: string; amount: bigint }>();
  for (const order of orders) {
    if (order.side !== 'buy') continue;
    const held = escrowByHouse.get(order.house_id) ?? { worldId: order.world_id, amount: 0n };
    held.amount += BigInt(order.price) * BigInt(order.remaining);
    escrowByHouse.set(order.house_id, held);
  }
  for (const [houseId, { worldId, amount: exact }] of [...escrowByHouse].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const amount = Number(exact);
    if (amount === 0) continue;
    if (!Number.isSafeInteger(amount))
      throw new Error(`Escrow of house ${houseId} is out of range`);
    const accountOf = (kind: 'house' | 'escrow') =>
      trx
        .selectFrom('game.accounts')
        .select('id')
        .where('house_id', '=', houseId)
        .where('kind', '=', kind);
    // La trésorerie d'abord, verrouillée avant toute ligne, puis le séquestre : comme `market.cancelOrder`.
    const treasury = await accountOf('house').forUpdate().executeTakeFirstOrThrow();
    const escrow = await accountOf('escrow').executeTakeFirstOrThrow();
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: worldId,
        kind: 'market.escrow_release',
        meta: JSON.stringify(meta(houseId)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('game.ledger_lines')
      .values([
        { entry_id: entry.id, account_id: escrow.id, amount: -amount },
        { entry_id: entry.id, account_id: treasury.id, amount },
      ])
      .execute();
  }
  await trx
    .updateTable('game.orders')
    .set({ status: 'cancelled' })
    .where(
      'id',
      'in',
      orders.map((order) => order.id),
    )
    .execute();
  for (const order of orders)
    emit({
      type: 'OrderCancelled',
      payload: {
        orderId: order.id,
        houseId: order.house_id,
        cityId: order.city_id,
        goodId: order.good_id,
        side: order.side,
        released: Number(order.remaining),
      },
    });
}
