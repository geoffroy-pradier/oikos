import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  db,
  ELAIA,
  eventsAbout,
  KALLISTE,
  lease,
  leasesOf,
  listingsOf,
  newOwner,
  newPlayer,
  offerLease,
  owner,
  send,
} from './property.integration-fixtures';

// Baux entre maisons, contre Supabase local. Chaque test fonde ses maisons et ses biens.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const endLease = (user: string, leaseId: string) => send(user, 'property.endLease', { leaseId });

/** Alice possède un bien qu'elle offre à la location à `rent` oboles par jour. */
async function offered(rent = 40, cityId: string = KALLISTE) {
  const alice = await newOwner(cityId);
  expect((await offerLease(alice.user, alice.propertyId, rent)).status).toBe(200);
  return alice;
}

describe('property.lease', () => {
  it('Bob loue au loyer vu, sans rien payer à la signature ; le bien loué ne s’offre plus', async () => {
    const alice = await offered(40, ELAIA);
    const bob = await newPlayer(KALLISTE);
    const balances = [await balanceOf(alice.houseId), await balanceOf(bob.houseId)];
    const key = randomUUID();
    const signed = await lease(bob.user, alice.propertyId, 40, key);
    expect(signed).toMatchObject({
      status: 200,
      body: {
        data: { propertyId: alice.propertyId, cityId: ELAIA, sizeId: 'townhouse', rentOboles: 40 },
      },
    });
    const leaseId = signed.body.data.leaseId as string;
    const terms = { id: leaseId, landlord: alice.houseId, tenant: bob.houseId, rent: 40 };
    expect(await leasesOf(alice.propertyId)).toEqual([
      { ...terms, requested_by: null, ended_day: null, end_reason: null },
    ]);
    expect((await listingsOf(alice.propertyId)).map((row) => row.outcome)).toEqual(['leased']);
    expect(await eventsAbout('LeaseStarted', leaseId)).toEqual([
      {
        leaseId,
        propertyId: alice.propertyId,
        landlordHouseId: alice.houseId,
        tenantHouseId: bob.houseId,
        cityId: ELAIA,
        rentOboles: 40,
      },
    ]);
    expect(await lease(bob.user, alice.propertyId, 40, key)).toEqual(signed);
    expect([await balanceOf(alice.houseId), await balanceOf(bob.houseId)]).toEqual(balances);
    expect(codeOf(await offerLease(alice.user, alice.propertyId, 50))).toBe('PROPERTY_LEASED');
    const sale = { propertyId: alice.propertyId, priceOboles: 9_000 };
    expect(codeOf(await send(alice.user, 'property.listForSale', sale))).toBe('PROPERTY_LEASED');
    expect(codeOf(await lease(bob.user, alice.propertyId, 40))).toBe('PROPERTY_NOT_FOR_LEASE');
  });

  it('deux maisons louent à la fois le même bien : un seul bail', async () => {
    const alice = await offered();
    const [bob, chloe] = await Promise.all([newPlayer(KALLISTE), newPlayer(ELAIA)]);
    const replies = await Promise.all([bob, chloe].map((p) => lease(p.user, alice.propertyId, 40)));
    expect(replies.map((reply) => codeOf(reply) ?? reply.status).sort()).toEqual([
      200,
      'PROPERTY_NOT_FOR_LEASE',
    ]);
    const winner = replies[0]?.status === 200 ? bob : chloe;
    expect((await leasesOf(alice.propertyId)).map((row) => row.tenant)).toEqual([winner.houseId]);
  });

  it('une location et le retrait de l’offre à la fois : l’un ou l’autre, jamais les deux', async () => {
    const alice = await offered();
    const bob = await newPlayer(KALLISTE);
    const [signed, withdrawn] = await Promise.all([
      lease(bob.user, alice.propertyId, 40),
      send(alice.user, 'property.withdrawOffer', { propertyId: alice.propertyId }),
    ]);
    const leased = signed.status === 200;
    expect([leased, withdrawn.status === 200]).toContainEqual(true);
    expect(leased && withdrawn.status === 200).toBe(false);
    expect(codeOf(leased ? withdrawn : signed)).toBe(
      leased ? 'PROPERTY_NOT_LISTED' : 'PROPERTY_NOT_FOR_LEASE',
    );
    expect(await leasesOf(alice.propertyId)).toHaveLength(leased ? 1 : 0);
    expect((await listingsOf(alice.propertyId)).map((row) => row.outcome)).toEqual([
      leased ? 'leased' : 'withdrawn',
    ]);
  });

  it('refus sans bail : loyer changé, son propre bien, offre de vente, bien inconnu', async () => {
    const alice = await offered(40);
    const bob = await newPlayer(KALLISTE);
    expect(codeOf(await lease(bob.user, alice.propertyId, 39))).toBe('PRICE_CHANGED');
    expect(codeOf(await lease(alice.user, alice.propertyId, 40))).toBe('OWN_PROPERTY');
    const seller = await newOwner(KALLISTE);
    const sale = { propertyId: seller.propertyId, priceOboles: 40 };
    expect((await send(seller.user, 'property.listForSale', sale)).status).toBe(200);
    expect(codeOf(await lease(bob.user, seller.propertyId, 40))).toBe('PROPERTY_NOT_FOR_LEASE');
    expect(codeOf(await lease(bob.user, randomUUID(), 40))).toBe('PROPERTY_NOT_FOUND');
    expect([...(await leasesOf(alice.propertyId)), ...(await leasesOf(seller.propertyId))]).toEqual(
      [],
    );
  });
});

describe('property.endLease', () => {
  it('l’une ou l’autre partie demande la fin, une fois ; le bail court jusqu’à la clôture', async () => {
    const alice = await offered();
    const [bob, chloe] = await Promise.all([newPlayer(KALLISTE), newPlayer(KALLISTE)]);
    const leaseId = (await lease(bob.user, alice.propertyId, 40)).body.data.leaseId as string;
    expect(codeOf(await endLease(chloe.user, leaseId))).toBe('LEASE_NOT_FOUND');
    expect(codeOf(await endLease(chloe.user, randomUUID()))).toBe('LEASE_NOT_FOUND');
    const ending = await endLease(bob.user, leaseId);
    expect(ending).toMatchObject({
      status: 200,
      body: { data: { leaseId, propertyId: alice.propertyId, requestedBy: 'tenant' } },
    });
    expect(codeOf(await endLease(alice.user, leaseId))).toBe('LEASE_ENDING');
    expect(await leasesOf(alice.propertyId)).toMatchObject([
      { requested_by: 'tenant', ended_day: null, end_reason: null },
    ]);
    expect(await eventsAbout('LeaseEndRequested', leaseId)).toEqual([
      {
        leaseId,
        propertyId: alice.propertyId,
        landlordHouseId: alice.houseId,
        tenantHouseId: bob.houseId,
        requestedBy: 'tenant',
      },
    ]);
    // Le propriétaire peut aussi la demander, sur un autre bail.
    const other = await offered();
    const otherId = (await lease(chloe.user, other.propertyId, 40)).body.data.leaseId as string;
    expect((await endLease(other.user, otherId)).body.data).toMatchObject({
      requestedBy: 'landlord',
    });
  });
});
