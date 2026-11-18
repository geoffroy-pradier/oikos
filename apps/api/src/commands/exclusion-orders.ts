import type { DomainEvent } from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';

/**
 * Annule les ordres ouverts de toutes les maisons d'un compte exclu, dans la transaction qui valide l'exclusion
 * (docs/specs/15-back-office-olympe.md, 15.4 ; #528) : chaque ordre l'est comme par `market.cancelOrder`, le reste
 * seul (ce qui a été servi reste acquis). La base lève la réservation d'une vente (déclencheur des ordres) ; le
 * séquestre des achats revient à la trésorerie de leur maison, en une écriture par maison au grand livre. Les
 * stocks et la trésorerie restent à la maison : leur saisie est hors de ce ticket.
 *
 * Ordre des verrous. D'abord le verrou d'agora de chaque monde où le compte a une maison, dans l'ordre des
 * identifiants, avant toute ligne, comme un ordre placé, la demande des PNJ, la clôture et le rachat : ils
 * l'attendent, ou la validation les attend, sans interblocage, et aucun ordre de ces mondes ne se place ni ne
 * s'exécute entre la lecture et l'annulation. Puis les ordres, dans l'ordre des identifiants ; puis, maison par
 * maison, la trésorerie et le séquestre ; enfin la mise à jour des ordres, qui touche les stocks. C'est l'ordre de
 * `market.cancelOrder`, que le compte peut encore envoyer au même instant : l'un attend l'autre, et le second ne
 * trouve plus l'ordre ouvert (Postgres relit la condition sur la ligne verrouillée), si bien qu'aucun séquestre
 * n'est rendu deux fois.
 *
 * Rien de ce qui est annulé ou rendu ne sort dans la réponse de la commande : les modérateurs, qui valident une
 * exclusion, ne lisent aucune donnée économique privée (15.4). Le grand livre et les événements le gardent.
 */
export async function cancelOrdersOfExcluded(
  trx: Db,
  userId: string,
  emit: (event: DomainEvent) => void,
): Promise<void> {
  const locked = new Set<string>();
  const lockWorlds = async (worldIds: Iterable<string>) => {
    for (const worldId of [...new Set(worldIds)].filter((id) => !locked.has(id)).sort()) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${worldId}`}, 0))`.execute(
        trx,
      );
      locked.add(worldId);
    }
  };
  const houses = await trx
    .selectFrom('game.houses')
    .select('world_id')
    .where('user_id', '=', userId)
    .execute();
  await lockWorlds(houses.map((house) => house.world_id));
  const orders = await trx
    .selectFrom('game.orders')
    .select(['id', 'world_id', 'house_id', 'city_id', 'good_id', 'side', 'price', 'remaining'])
    .where('house_id', 'in', (own) =>
      own.selectFrom('game.houses').select('id').where('user_id', '=', userId),
    )
    .where('status', '=', 'open')
    .orderBy('id')
    .forUpdate()
    .execute();
  // Cas rare : une maison fondée dans un autre monde entre la lecture des maisons et celle des ordres, et déjà un
  // ordre ouvert. Son verrou d'agora est pris après ses lignes, comme dans le rachat : un interblocage éventuel est
  // rompu par Postgres et la commande rejouée (#333). Les ordres lus sont déjà verrouillés.
  await lockWorlds(orders.map((order) => order.world_id));
  if (orders.length === 0) return;

  // Séquestre à rendre par maison : prix × reste de ses achats ouverts, compté en entiers exacts.
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
        meta: JSON.stringify({ houseId, cause: 'exclusion' }),
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
