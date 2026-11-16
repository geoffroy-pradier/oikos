import {
  PROPERTY_END_LEASE_ERROR_CODES,
  PROPERTY_LEASE_ERROR_CODES,
  propertyEndLeaseInputSchema,
  propertyEndLeaseOutputSchema,
  propertyLeaseInputSchema,
  propertyLeaseOutputSchema,
} from '@oikos/contracts';
import { sql } from 'kysely';
import { defineCommand } from '../registry';
import { lockHouseProperty, openListingOf, refuse } from './property-offer';

const NOT_FOR_LEASE = {
  code: 'PROPERTY_NOT_FOR_LEASE',
  message: 'This property is not for lease.',
};

/**
 * La maison loue un bien offert à la location (docs/specs/04-systemes-gestion.md, 4.5), au loyer qu'elle a
 * vu : un autre loyer est refusé. Rien n'est payé à la signature ; le loyer se paie à chaque clôture,
 * d'abord à la première qui suit. Deux locations du même bien se suivent (verrou de l'agora, puis le bien)
 * et la seconde trouve l'offre fermée ; la base n'admet qu'un bail actif par bien et par offre.
 */
export const propertyLease = defineCommand({
  name: 'property.lease',
  input: propertyLeaseInputSchema,
  output: propertyLeaseOutputSchema,
  errors: PROPERTY_LEASE_ERROR_CODES,
  errorByConstraint: { leases_active_once: NOT_FOR_LEASE, leases_listing_once: NOT_FOR_LEASE },
  async handler({ trx, userId, emit }, input) {
    const locked = await lockHouseProperty(trx, userId, input.propertyId);
    if (!locked.ok) return locked;
    const { house, property } = locked;
    if (property.owner_house_id === house.id)
      return refuse('OWN_PROPERTY', 'A house does not lease its own property.');
    const listing = await openListingOf(trx, property.id);
    if (!listing || listing.kind !== 'lease')
      return refuse(NOT_FOR_LEASE.code, NOT_FOR_LEASE.message);
    const rentOboles = Number(listing.price_oboles);
    if (input.expectedRentOboles !== rentOboles)
      return refuse('PRICE_CHANGED', `This property now rents for ${rentOboles} oboles a day.`);

    // Le bail d'abord : la base ne ferme une offre « louée » que sur un bail de la même transaction.
    const lease = await trx
      .insertInto('game.leases')
      .values({
        world_id: house.world_id,
        property_id: property.id,
        listing_id: listing.id,
        landlord_house_id: listing.house_id,
        tenant_house_id: house.id,
        rent_oboles: rentOboles,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .updateTable('game.property_listings')
      .set({ outcome: 'leased' })
      .where('id', '=', listing.id)
      .execute();
    emit({
      type: 'LeaseStarted',
      payload: {
        leaseId: lease.id,
        propertyId: property.id,
        landlordHouseId: listing.house_id,
        tenantHouseId: house.id,
        cityId: property.city_id,
        rentOboles,
      },
    });
    const data = { leaseId: lease.id, propertyId: property.id, cityId: property.city_id };
    return { ok: true, data: { ...data, sizeId: property.size_id, rentOboles } };
  },
});

/**
 * L'une ou l'autre partie demande la fin d'un bail : elle prend effet à la clôture suivante, qui ne demande
 * alors plus de loyer (4.5). La demande ne se fait qu'une fois et ne se retire pas.
 */
export const propertyEndLease = defineCommand({
  name: 'property.endLease',
  input: propertyEndLeaseInputSchema,
  output: propertyEndLeaseOutputSchema,
  errors: PROPERTY_END_LEASE_ERROR_CODES,
  async handler({ trx, userId, emit }, input) {
    const house = await trx
      .selectFrom('game.houses')
      .select(['id', 'world_id'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!house) return refuse('HOUSE_NOT_FOUND', 'This account has no house.');
    // Le verrou de l'agora, comme les autres commandes de l'immobilier et la clôture qui met fin au bail.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`market:${house.world_id}`}, 0))`.execute(
      trx,
    );
    const lease = await trx
      .selectFrom('game.leases')
      .select(['id', 'property_id', 'landlord_house_id', 'tenant_house_id', 'end_requested_by'])
      .where('id', '=', input.leaseId)
      .where('world_id', '=', house.world_id)
      .where('ended_at', 'is', null)
      .where((eb) =>
        eb.or([eb('landlord_house_id', '=', house.id), eb('tenant_house_id', '=', house.id)]),
      )
      .forUpdate()
      .executeTakeFirst();
    if (!lease) return refuse('LEASE_NOT_FOUND', 'Unknown or ended lease.');
    if (lease.end_requested_by !== null)
      return refuse('LEASE_ENDING', 'This lease already ends at the next close.');
    const requestedBy = lease.landlord_house_id === house.id ? 'landlord' : 'tenant';
    await trx
      .updateTable('game.leases')
      .set({ end_requested_by: requestedBy })
      .where('id', '=', lease.id)
      .execute();
    const ending = { leaseId: lease.id, propertyId: lease.property_id };
    emit({
      type: 'LeaseEndRequested',
      payload: {
        ...ending,
        landlordHouseId: lease.landlord_house_id,
        tenantHouseId: lease.tenant_house_id,
        requestedBy,
      },
    });
    return { ok: true, data: { ...ending, requestedBy } };
  },
});
