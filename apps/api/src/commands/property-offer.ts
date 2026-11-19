import {
  PROPERTY_OFFER_ERROR_CODES,
  PROPERTY_WITHDRAW_OFFER_ERROR_CODES,
  propertyListForSaleInputSchema,
  propertyOfferLeaseInputSchema,
  propertyOfferOutputSchema,
  propertyWithdrawOfferInputSchema,
  propertyWithdrawOfferOutputSchema,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import type { z } from 'zod';
import { defineCommand } from '../registry';
import { accountHouseId } from '@oikos/operations';

export const refuse = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
});

/**
 * La maison du compte et un bien de son monde, puis, dans cet ordre, le verrou de l'agora du monde et le
 * bien verrouillé : comme `property.buy`, la clôture (agora d'abord) et toutes les commandes de
 * l'immobilier entre maisons, qui se suivent donc sur un même bien. Un refus est rendu tel quel.
 */
export async function lockHouseProperty(trx: Db, userId: string, propertyId: string) {
  const house = await trx
    .selectFrom('game.houses')
    .select(['id', 'world_id'])
    .where('id', '=', accountHouseId(userId))
    .executeTakeFirst();
  if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
  const known = await trx
    .selectFrom('game.properties')
    .select('id')
    .where('id', '=', propertyId)
    .where('world_id', '=', house.world_id)
    .executeTakeFirst();
  if (!known) return refuse('PROPERTY_NOT_FOUND', 'Unknown property.');
  await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${house.world_id}`}, 0))`.execute(
    trx,
  );
  const property = await trx
    .selectFrom('game.properties')
    .select(['id', 'city_id', 'size_id', 'owner_house_id'])
    .where('id', '=', propertyId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return { ok: true as const, house, property };
}

/** L'offre ouverte du bien, s'il en a une. */
export const openListingOf = (trx: Db, propertyId: string) =>
  trx
    .selectFrom('game.property_listings')
    .select(['id', 'house_id', 'kind', 'price_oboles'])
    .where('property_id', '=', propertyId)
    .where('closed_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();

const ALREADY_LISTED = {
  code: 'PROPERTY_ALREADY_LISTED',
  message: 'This property is already offered.',
};

/**
 * Offre d'un bien par la maison qui le possède (docs/specs/04-systemes-gestion.md, 4.5) : à la vente, à
 * prix affiché, ou à la location, au loyer quotidien demandé. Un bien loué ne s'offre pas, et une seule
 * offre est ouverte par bien : la base le garantit aussi (garde et index unique).
 */
const defineOffer = <I extends { propertyId: string }>(
  name: string,
  kind: 'sale' | 'lease',
  input: z.ZodType<I>,
  priceOf: (input: I) => number,
) =>
  defineCommand({
    name,
    input,
    output: propertyOfferOutputSchema,
    errors: PROPERTY_OFFER_ERROR_CODES,
    errorByConstraint: { property_listings_open_once: ALREADY_LISTED },
    async handler({ trx, userId, emit }, input) {
      const locked = await lockHouseProperty(trx, userId, input.propertyId);
      if (!locked.ok) return locked;
      const { house, property } = locked;
      if (property.owner_house_id !== house.id)
        return refuse('PROPERTY_NOT_OWNED', 'This property is not yours.');
      const leased = await trx
        .selectFrom('game.leases')
        .select('id')
        .where('property_id', '=', property.id)
        .where('ended_at', 'is', null)
        .executeTakeFirst();
      if (leased) return refuse('PROPERTY_LEASED', 'This property is leased.');
      if (await openListingOf(trx, property.id))
        return refuse(ALREADY_LISTED.code, ALREADY_LISTED.message);
      const priceOboles = priceOf(input);
      const listing = await trx
        .insertInto('game.property_listings')
        .values({
          world_id: house.world_id,
          property_id: property.id,
          house_id: house.id,
          kind,
          price_oboles: priceOboles,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const offer = { listingId: listing.id, propertyId: property.id, kind };
      emit({
        type: 'PropertyOffered',
        payload: { ...offer, houseId: house.id, cityId: property.city_id, priceOboles },
      });
      return { ok: true, data: { ...offer, priceOboles } };
    },
  });

export const propertyOfferLease = defineOffer(
  'property.offerLease',
  'lease',
  propertyOfferLeaseInputSchema,
  (input) => input.rentOboles,
);
export const propertyListForSale = defineOffer(
  'property.listForSale',
  'sale',
  propertyListForSaleInputSchema,
  (input) => input.priceOboles,
);

/** La maison retire l'offre ouverte d'un de ses biens, de vente comme de location. */
export const propertyWithdrawOffer = defineCommand({
  name: 'property.withdrawOffer',
  input: propertyWithdrawOfferInputSchema,
  output: propertyWithdrawOfferOutputSchema,
  errors: PROPERTY_WITHDRAW_OFFER_ERROR_CODES,
  async handler({ trx, userId, emit }, input) {
    const locked = await lockHouseProperty(trx, userId, input.propertyId);
    if (!locked.ok) return locked;
    const { house, property } = locked;
    if (property.owner_house_id !== house.id)
      return refuse('PROPERTY_NOT_OWNED', 'This property is not yours.');
    const listing = await openListingOf(trx, property.id);
    if (!listing) return refuse('PROPERTY_NOT_LISTED', 'This property is not offered.');
    await trx
      .updateTable('game.property_listings')
      .set({ outcome: 'withdrawn' })
      .where('id', '=', listing.id)
      .execute();
    const withdrawn = { listingId: listing.id, propertyId: property.id, kind: listing.kind };
    emit({ type: 'PropertyOfferWithdrawn', payload: { ...withdrawn, houseId: house.id } });
    return { ok: true, data: withdrawn };
  },
});
