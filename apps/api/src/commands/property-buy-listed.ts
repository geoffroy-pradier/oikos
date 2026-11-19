import {
  PROPERTY_BUY_LISTED_ERROR_CODES,
  propertyBuyListedInputSchema,
  propertyBuyListedOutputSchema,
} from '@oikos/contracts';
import { cityRatesOf } from '@oikos/db';
import { marketTax } from '@oikos/sim';
import { defineCommand } from '../registry';
import { lockHouseProperty, openListingOf, refuse } from './property-offer';

const NOT_FOR_SALE = { code: 'PROPERTY_NOT_FOR_SALE', message: 'This property is not for sale.' };

/**
 * La maison achète un bien mis en vente par une autre (docs/specs/04-systemes-gestion.md, 4.5), au prix
 * affiché qu'elle a vu, sans enchère. Elle paie le prix, le vendeur en reçoit le net de la taxe de marché
 * de la cité du bien, au taux de cette cité, prélevée comme à l'agora (5.3, même calcul `marketTax`, même répartition entre le
 * puits `sink_market_tax` et le trésor de la cité), dans une seule écriture `property.sale` : la revente
 * transfère de la monnaie sans en créer, et n'en détruit que la part détruite de la taxe. La base ne cède
 * le bien qu'à cette écriture, et ne règle l'offre qu'une fois.
 */
export const propertyBuyListed = defineCommand({
  name: 'property.buyListed',
  input: propertyBuyListedInputSchema,
  output: propertyBuyListedOutputSchema,
  errors: PROPERTY_BUY_LISTED_ERROR_CODES,
  errorByConstraint: {
    accounts_no_overdraft: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough money.' },
    ledger_entries_property_sold_once: NOT_FOR_SALE,
  },
  async handler({ trx, userId, emit, config }, input) {
    const locked = await lockHouseProperty(trx, userId, input.propertyId);
    if (!locked.ok) return locked;
    const { house, property } = locked;
    if (property.owner_house_id === house.id)
      return refuse('OWN_PROPERTY', 'A house does not buy its own property.');
    const listing = await openListingOf(trx, property.id);
    if (!listing || listing.kind !== 'sale') return refuse(NOT_FOR_SALE.code, NOT_FOR_SALE.message);
    const priceOboles = Number(listing.price_oboles);
    if (input.expectedPriceOboles !== priceOboles)
      return refuse('PRICE_CHANGED', `This property now costs ${priceOboles} oboles.`);

    // Les deux trésoreries dans l'ordre de leurs identifiants, comme toute transaction qui en verrouille
    // deux sous le verrou de l'agora : deux reventes croisées ne s'attendent pas l'une l'autre.
    const treasuries = await trx
      .selectFrom('game.accounts')
      .select(['id', 'house_id', 'balance'])
      .where('kind', '=', 'house')
      .where('house_id', 'in', [house.id, listing.house_id])
      .orderBy('id')
      .forUpdate()
      .execute();
    const buyer = treasuries.find((account) => account.house_id === house.id);
    const seller = treasuries.find((account) => account.house_id === listing.house_id);
    if (!buyer || !seller) throw new Error(`Missing treasury for the sale of ${property.id}`);
    if (Number(buyer.balance) < priceOboles)
      return refuse('INSUFFICIENT_FUNDS', 'Not enough money.');
    // Taux de la cité du bien, lu sous le verrou de l'agora pris par `lockHouseProperty`.
    const rates = await cityRatesOf(trx, house.world_id, property.city_id, config);
    const tax = marketTax(priceOboles, {
      rateBps: rates.marketTaxRateBps,
      burnShareBps: config.marketTax.burnShareBps,
    });
    const taxAccount = (column: 'system_key' | 'city_id', value: string) =>
      trx
        .selectFrom('game.accounts')
        .select('id')
        .where('world_id', '=', house.world_id)
        .where(column, '=', value)
        // Le trésor de la cité, jamais sa bourse des PNJ (#632), quel que soit le rôle de la connexion.
        .where('npc_purse', '=', false)
        .executeTakeFirstOrThrow(
          () => new Error(`World ${house.world_id} has no ${value} account`),
        );
    const levies = [
      ...(tax.burned > 0
        ? [
            {
              account_id: (await taxAccount('system_key', 'sink_market_tax')).id,
              amount: tax.burned,
            },
          ]
        : []),
      ...(tax.treasury > 0
        ? [{ account_id: (await taxAccount('city_id', property.city_id)).id, amount: tax.treasury }]
        : []),
    ];

    // L'écriture, puis l'offre vendue, puis le bien : la base ne ferme l'offre que sur l'écriture de la
    // transaction, et ne cède le bien qu'une fois l'offre fermée.
    const entry = await trx
      .insertInto('game.ledger_entries')
      .values({
        world_id: house.world_id,
        kind: 'property.sale',
        meta: JSON.stringify({
          propertyId: property.id,
          listingId: listing.id,
          sellerHouseId: listing.house_id,
          buyerHouseId: house.id,
        }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('game.ledger_lines')
      .values(
        [
          { account_id: buyer.id, amount: -priceOboles },
          { account_id: seller.id, amount: tax.net },
          ...levies,
        ]
          // Une ligne nulle n'est pas une ligne : vente d'une obole dont la taxe prend tout.
          .filter((line) => line.amount !== 0)
          .map((line) => ({ entry_id: entry.id, ...line })),
      )
      .execute();
    await trx
      .updateTable('game.property_listings')
      .set({ outcome: 'sold', ledger_entry_id: entry.id })
      .where('id', '=', listing.id)
      .execute();
    await trx
      .updateTable('game.properties')
      .set({ owner_house_id: house.id })
      .where('id', '=', property.id)
      .execute();

    const sold = { propertyId: property.id, cityId: property.city_id, sizeId: property.size_id };
    emit({
      type: 'PropertySold',
      payload: {
        ...sold,
        listingId: listing.id,
        sellerHouseId: listing.house_id,
        buyerHouseId: house.id,
        priceOboles,
        netOboles: tax.net,
        burnedOboles: tax.burned,
        treasuryOboles: tax.treasury,
      },
    });
    return { ok: true, data: { ...sold, priceOboles } };
  },
});
