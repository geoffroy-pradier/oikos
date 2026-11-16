import {
  PROPERTY_RENOVATE_ERROR_CODES,
  propertyRenovateInputSchema,
  propertyRenovateOutputSchema,
} from '@oikos/contracts';
import { PROPERTY_CONDITION_MAX } from '@oikos/sim';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});
const NO_STOCK = { code: 'INSUFFICIENT_STOCK', message: 'Not enough free stock for the works.' };
const byGood = (a: { goodId: string }, b: { goodId: string }) => (a.goodId < b.goodId ? -1 : 1);
/** Une liste de biens, rangée par identifiant, en texte : deux coûts égaux ont le même. */
const goodsKey = (goods: readonly { goodId: string; quantity: number }[]) =>
  JSON.stringify([...goods].sort(byGood).map(({ goodId, quantity }) => [goodId, quantity]));

/**
 * La maison rénove un bien qu'elle possède (docs/specs/04-systemes-gestion.md, 4.5) : il redevient neuf.
 * Le coût en oboles de sa taille est détruit (puits `sink_property_works`) par une écriture
 * `property.renovate`, dont la ligne de débit est marquée `upkeep` (4.1) ; les biens de la rénovation
 * sortent du stock libre de la maison dans la cité du bien vers l'extrémité `consumption` du journal des
 * stocks, rattachés à cette écriture, dans la même transaction. Un autre coût que celui vu est refusé.
 */
export const propertyRenovate = defineCommand({
  name: 'property.renovate',
  input: propertyRenovateInputSchema,
  output: propertyRenovateOutputSchema,
  errors: PROPERTY_RENOVATE_ERROR_CODES,
  // La base fait foi sous concurrence : ni découvert, ni stock réservé consommé.
  errorByConstraint: {
    accounts_no_overdraft: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' },
    inventories_reserved_within_quantity: NO_STOCK,
    inventories_quantity_check: NO_STOCK,
  },
  async handler({ trx, userId, emit, config }, input) {
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const known = await trx
      .selectFrom('game.properties')
      .select('id')
      .where('id', '=', input.propertyId)
      .where('world_id', '=', house.world_id)
      .executeTakeFirst();
    if (!known) return refuse('PROPERTY_NOT_FOUND', 'Unknown property.');

    // Ordre des verrous : l'agora du monde, la trésorerie, le bien, puis les stocks dans l'ordre des biens,
    // comme `property.buy` et `voyage.depart` ; la clôture prend l'agora d'abord, et aucun stock.
    const agora = `market:${house.world_id}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${agora}, 0))`.execute(trx);
    const account = await trx
      .selectFrom('game.accounts')
      .select(['id', 'balance'])
      .where('house_id', '=', house.id)
      .where('kind', '=', 'house')
      .forUpdate()
      .executeTakeFirstOrThrow();
    const property = await trx
      .selectFrom('game.properties')
      .select(['owner_house_id', 'city_id', 'size_id', 'condition'])
      .where('id', '=', known.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (property.owner_house_id !== house.id)
      return refuse('PROPERTY_NOT_OWNED', 'This property belongs to someone else.');
    const size = config.properties.sizes.find((candidate) => candidate.id === property.size_id);
    if (!size)
      return refuse('PROPERTY_SIZE_RETIRED', 'This kind of property has no works anymore.');
    if (property.condition >= PROPERTY_CONDITION_MAX)
      return refuse('NOTHING_TO_RENOVATE', 'This property is already in full condition.');
    const { oboles: costOboles } = size.renovation;
    const goods = [...size.renovation.goods].sort(byGood);
    // Le coût affiché fait foi, en oboles comme en biens : un autre tarif n'est ni payé ni consommé.
    if (
      input.expectedCostOboles !== costOboles ||
      goodsKey(input.expectedGoods) !== goodsKey(goods)
    )
      return refuse('PRICE_CHANGED', `These works now cost ${costOboles} oboles and other goods.`);

    // Stocks libres de la cité du bien, verrouillés dans l'ordre des biens (classement "C") : ce que
    // réservent les ventes en attente n'est pas consommé.
    const goodIds = goods.map((entry) => entry.goodId);
    const stocks =
      goodIds.length === 0
        ? []
        : await trx
            .selectFrom('game.inventories')
            .select(['id', 'good_id', 'quantity', 'reserved'])
            .where('house_id', '=', house.id)
            .where('city_id', '=', property.city_id)
            .where('good_id', 'in', goodIds)
            .orderBy(sql`good_id collate "C"`)
            .forUpdate()
            .execute();
    const stockOf = (goodId: string) => stocks.find((stock) => stock.good_id === goodId);
    for (const { goodId, quantity } of goods) {
      const stock = stockOf(goodId);
      if (!stock || Number(stock.quantity) - Number(stock.reserved) < quantity)
        return refuse(NO_STOCK.code, NO_STOCK.message);
    }
    if (Number(account.balance) < costOboles)
      return refuse('INSUFFICIENT_FUNDS', 'Not enough money.');
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', house.world_id)
      .where('system_key', '=', 'sink_property_works')
      .executeTakeFirstOrThrow(
        () => new Error(`World ${house.world_id} has no sink_property_works account`),
      );

    // L'écriture d'abord : la garde de la base ne relève l'état d'un bien que devant une écriture de
    // rénovation de la transaction qui débite la trésorerie de son propriétaire.
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: house.world_id,
        kind: 'property.renovate',
        meta: JSON.stringify({ houseId: house.id, propertyId: known.id, goods }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('game.ledger_lines')
      .values([
        { entry_id: entry.id, account_id: account.id, amount: -costOboles, nature: 'upkeep' },
        { entry_id: entry.id, account_id: sink.id, amount: costOboles },
      ])
      .execute();
    if (goods.length > 0)
      await trx
        .insertInto('game.stock_ledger')
        .values(
          goods.map(({ goodId, quantity }) => ({
            world_id: house.world_id,
            good_id: goodId,
            quantity,
            from_inventory_id: stockOf(goodId)?.id ?? null,
            to_system: 'consumption',
            kind: 'property.renovate',
            ledger_entry_id: entry.id,
          })),
        )
        .execute();
    await trx
      .updateTable('game.properties')
      .set({ condition: PROPERTY_CONDITION_MAX })
      .where('id', '=', known.id)
      .execute();

    emit({
      type: 'PropertyRenovated',
      payload: {
        propertyId: known.id,
        houseId: house.id,
        cityId: property.city_id,
        sizeId: size.id,
        costOboles,
        goods,
        conditionBefore: property.condition,
      },
    });
    return {
      ok: true,
      data: { propertyId: known.id, costOboles, goods, condition: PROPERTY_CONDITION_MAX },
    };
  },
});
