import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  db,
  ELAIA,
  eventsOf,
  KALLISTE,
  listingsOf,
  newOwner,
  newPlayer,
  newProperty,
  owner,
  send,
} from './property.integration-fixtures';

// Offres d'un bien entre maisons, contre Supabase local. Chaque test fonde ses maisons et ses biens.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const offerLease = (user: string, propertyId: string, rentOboles: number, key?: string) =>
  send(user, 'property.offerLease', { propertyId, rentOboles }, key);
const listForSale = (user: string, propertyId: string, priceOboles: number) =>
  send(user, 'property.listForSale', { propertyId, priceOboles });
const withdraw = (user: string, propertyId: string) =>
  send(user, 'property.withdrawOffer', { propertyId });

describe('property.offerLease, property.listForSale, property.withdrawOffer', () => {
  it('le propriétaire propose son bien à louer, sans rien payer ; la même clé rejoue', async () => {
    const alice = await newOwner(KALLISTE);
    const balance = await balanceOf(alice.houseId);
    const key = randomUUID();
    const offered = await offerLease(alice.user, alice.propertyId, 40, key);
    expect(offered).toMatchObject({
      status: 200,
      body: { data: { propertyId: alice.propertyId, kind: 'lease', priceOboles: 40 } },
    });
    const listingId = offered.body.data.listingId as string;
    expect(await listingsOf(alice.propertyId)).toEqual([
      { house_id: alice.houseId, kind: 'lease', price: 40, outcome: null },
    ]);
    expect(await eventsOf(alice.houseId, 'PropertyOffered')).toEqual([
      {
        listingId,
        propertyId: alice.propertyId,
        houseId: alice.houseId,
        kind: 'lease',
        cityId: KALLISTE,
        priceOboles: 40,
      },
    ]);
    expect(await offerLease(alice.user, alice.propertyId, 40, key)).toEqual(offered);
    expect(await listingsOf(alice.propertyId)).toHaveLength(1);
    expect(await balanceOf(alice.houseId)).toBe(balance);
  });

  it('une offre ouverte par bien ; retirée, le bien s’offre de nouveau, à la vente cette fois', async () => {
    const alice = await newOwner(ELAIA);
    expect((await listForSale(alice.user, alice.propertyId, 9_000)).status).toBe(200);
    expect(codeOf(await offerLease(alice.user, alice.propertyId, 40))).toBe(
      'PROPERTY_ALREADY_LISTED',
    );
    expect(codeOf(await listForSale(alice.user, alice.propertyId, 8_000))).toBe(
      'PROPERTY_ALREADY_LISTED',
    );
    const withdrawn = await withdraw(alice.user, alice.propertyId);
    expect(withdrawn).toMatchObject({ status: 200, body: { data: { kind: 'sale' } } });
    expect(await eventsOf(alice.houseId, 'PropertyOfferWithdrawn')).toEqual([
      { ...withdrawn.body.data, houseId: alice.houseId },
    ]);
    expect(codeOf(await withdraw(alice.user, alice.propertyId))).toBe('PROPERTY_NOT_LISTED');
    expect((await listForSale(alice.user, alice.propertyId, 8_000)).status).toBe(200);
    expect(await listingsOf(alice.propertyId)).toEqual([
      { house_id: alice.houseId, kind: 'sale', price: 9_000, outcome: 'withdrawn' },
      { house_id: alice.houseId, kind: 'sale', price: 8_000, outcome: null },
    ]);
  });

  it('deux offres à la fois du même bien : une seule s’ouvre', async () => {
    const alice = await newOwner(KALLISTE);
    const replies = await Promise.all([
      offerLease(alice.user, alice.propertyId, 40),
      listForSale(alice.user, alice.propertyId, 9_000),
    ]);
    expect(replies.map((reply) => codeOf(reply) ?? reply.status).sort()).toEqual([
      200,
      'PROPERTY_ALREADY_LISTED',
    ]);
    expect(await listingsOf(alice.propertyId)).toHaveLength(1);
  });

  it('refus sans effet : bien d’une autre maison ou de la cité, bien inconnu, montant invalide', async () => {
    const alice = await newOwner(KALLISTE);
    const bob = await newPlayer(KALLISTE);
    const cityHeld = await newProperty(KALLISTE);
    expect(codeOf(await offerLease(bob.user, alice.propertyId, 40))).toBe('PROPERTY_NOT_OWNED');
    expect(codeOf(await listForSale(bob.user, cityHeld, 40))).toBe('PROPERTY_NOT_OWNED');
    expect((await listForSale(alice.user, alice.propertyId, 9_000)).status).toBe(200);
    expect(codeOf(await withdraw(bob.user, alice.propertyId))).toBe('PROPERTY_NOT_OWNED');
    expect(await offerLease(bob.user, randomUUID(), 40)).toMatchObject({
      status: 404,
      body: { error: { code: 'PROPERTY_NOT_FOUND' } },
    });
    expect((await offerLease(alice.user, cityHeld, 0)).status).toBe(400);
    expect(await listingsOf(cityHeld)).toEqual([]);
    expect(await eventsOf(bob.houseId, 'PropertyOffered')).toEqual([]);
    expect((await listingsOf(alice.propertyId)).map((row) => row.outcome)).toEqual([null]);
  });
});
