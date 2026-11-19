import {
  PROPERTY_BUY_ERROR_CODES,
  propertyBuyInputSchema,
  propertyBuyOutputSchema,
} from '@oikos/contracts';
import { sql } from 'kysely';
import { defineCommand, type CommandResult } from '../registry';
import { accountHouseId } from '@oikos/operations';

const refuse = (code: string, message: string): CommandResult<never> => ({
  ok: false,
  error: { code, message },
});
const NOT_FOR_SALE = { code: 'PROPERTY_NOT_FOR_SALE', message: 'This property is not for sale.' };

/**
 * La maison achète à la cité un bien qu'elle détient encore (docs/specs/04-systemes-gestion.md, 4.5),
 * dans n'importe quelle cité de son monde. Le prix de sa taille, fixé par la configuration, est détruit
 * (puits `sink_property_purchase`) par une écriture `property.buy` ; un autre prix que celui que le joueur
 * a vu est refusé, pas prélevé. La base refuse tout changement de propriétaire sans cette écriture.
 */
export const propertyBuy = defineCommand({
  name: 'property.buy',
  input: propertyBuyInputSchema,
  output: propertyBuyOutputSchema,
  errors: PROPERTY_BUY_ERROR_CODES,
  // La base fait foi sous concurrence : le compte d'une maison ne passe jamais sous zéro, et un bien
  // n'est acheté à la cité qu'une fois.
  errorByConstraint: {
    accounts_no_overdraft: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' },
    ledger_entries_property_bought_once: NOT_FOR_SALE,
  },
  async handler({ trx, userId, emit, config }, input) {
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('id', '=', accountHouseId(userId))
      .executeTakeFirst();
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    const property = await trx
      .selectFrom('game.properties')
      .select(['id', 'city_id', 'size_id', 'lot'])
      .where('id', '=', input.propertyId)
      .where('world_id', '=', house.world_id)
      .executeTakeFirst();
    if (!property) return refuse('PROPERTY_NOT_FOUND', 'Unknown property.');
    const size = config.properties.sizes.find((candidate) => candidate.id === property.size_id);
    if (!size) return refuse('PROPERTY_SIZE_RETIRED', 'This kind of property is not sold anymore.');

    // Ordre des verrous : l'agora du monde, la trésorerie, puis le bien, comme `voyage.depart` et la
    // clôture (agora, puits, trésoreries, sites, navires, biens) : deux achats du même bien se suivent,
    // et le second trouve le bien vendu ; un achat ne s'intercale pas dans le prélèvement d'une clôture.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${house.world_id}`}, 0))`.execute(
      trx,
    );
    const account = await trx
      .selectFrom('game.accounts')
      .select(['id', 'balance'])
      .where('house_id', '=', house.id)
      .where('kind', '=', 'house')
      .forUpdate()
      .executeTakeFirstOrThrow();
    const held = await trx
      .selectFrom('game.properties')
      .select('owner_house_id')
      .where('id', '=', property.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (held.owner_house_id !== null) return refuse(NOT_FOR_SALE.code, NOT_FOR_SALE.message);

    const priceOboles = size.purchasePriceOboles;
    // Le prix affiché fait foi : un autre tarif (configuration activée entre-temps) n'est pas prélevé.
    if (input.expectedPriceOboles !== priceOboles)
      return refuse('PRICE_CHANGED', `This property now costs ${priceOboles} oboles.`);
    if (Number(account.balance) < priceOboles)
      return refuse('INSUFFICIENT_FUNDS', 'Not enough money.');
    const sink = await trx
      .selectFrom('game.accounts')
      .select('id')
      .where('world_id', '=', house.world_id)
      .where('system_key', '=', 'sink_property_purchase')
      .executeTakeFirstOrThrow(
        () => new Error(`World ${house.world_id} has no sink_property_purchase account`),
      );

    // L'écriture d'abord : la garde de la base ne cède le bien qu'à une écriture d'achat de la
    // transaction qui débite déjà la trésorerie de l'acheteur.
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: house.world_id,
        kind: 'property.buy',
        meta: JSON.stringify({ houseId: house.id, propertyId: property.id }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('game.ledger_lines')
      .values([
        { entry_id: entry.id, account_id: account.id, amount: -priceOboles },
        { entry_id: entry.id, account_id: sink.id, amount: priceOboles },
      ])
      .execute();
    await trx
      .updateTable('game.properties')
      .set({ owner_house_id: house.id })
      .where('id', '=', property.id)
      .execute();

    const bought = { propertyId: property.id, cityId: property.city_id, sizeId: size.id };
    emit({ type: 'PropertyBought', payload: { ...bought, houseId: house.id, priceOboles } });
    return { ok: true, data: { ...bought, lot: property.lot, priceOboles } };
  },
});
