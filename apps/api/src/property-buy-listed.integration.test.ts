import { randomUUID } from 'node:crypto';
import { marketTax } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  db,
  ELAIA,
  eventsAbout,
  fund,
  KALLISTE,
  linesOf,
  listingsOf,
  newOwner,
  newPlayer,
  offerLease,
  owner,
  propertyOf,
  send,
} from './property.integration-fixtures';
import { TEST_CONFIG } from './test-config';
import { appWithConfig, type App } from './voyage.integration-fixtures';

// Revente d'un bien entre maisons, contre Supabase local. Chaque test fonde ses maisons et ses biens.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const list = (user: string, propertyId: string, priceOboles: number) =>
  send(user, 'property.listForSale', { propertyId, priceOboles });
const buyListed = (user: string, propertyId: string, price: number, key?: string, via?: App) =>
  send(user, 'property.buyListed', { propertyId, expectedPriceOboles: price }, key, via);
const cityTreasury = async (cityId: string) =>
  Number(
    (
      await sql<{ balance: string }>`select balance from game.accounts
        where kind = 'treasury' and city_id = ${cityId}`.execute(db)
    ).rows[0]?.balance,
  );
/** Monnaie de l'acheteur, du vendeur et du trésor de la cité, et ce que le puits de la taxe a détruit. */
const money = async (houses: string[], cityId: string) => ({
  held:
    (await Promise.all(houses.map((id) => balanceOf(id)))).reduce((sum, value) => sum + value, 0) +
    (await cityTreasury(cityId)),
  burned: await balanceOf('sink_market_tax'),
});

describe('property.buyListed', () => {
  it('Bob paie le prix affiché, Alice reçoit le net, la taxe va au puits et à la cité ; rien n’est créé', async () => {
    const alice = await newOwner(ELAIA);
    const bob = await newPlayer(KALLISTE);
    expect((await list(alice.user, alice.propertyId, 2_021)).status).toBe(200);
    const before = await money([alice.houseId, bob.houseId], ELAIA);
    const [aliceBefore, bobBefore] = [await balanceOf(alice.houseId), await balanceOf(bob.houseId)];
    // 5 %, moitié détruite, chaque part arrondie à l'obole supérieure : 102 de taxe, 51 détruites.
    expect(TEST_CONFIG.config.marketTax).toEqual({ rateBps: 500, burnShareBps: 5_000 });
    const tax = { net: 1_919, burned: 51, treasury: 51 };
    expect(marketTax(2_021, TEST_CONFIG.config.marketTax)).toEqual(tax);
    const key = randomUUID();
    const bought = await buyListed(bob.user, alice.propertyId, 2_021, key);
    expect(bought).toMatchObject({
      status: 200,
      body: {
        data: {
          propertyId: alice.propertyId,
          cityId: ELAIA,
          sizeId: 'townhouse',
          priceOboles: 2_021,
        },
      },
    });
    expect((await propertyOf(alice.propertyId))?.owner_house_id).toBe(bob.houseId);
    expect([await balanceOf(alice.houseId), await balanceOf(bob.houseId)]).toEqual([
      aliceBefore + tax.net,
      bobBefore - 2_021,
    ]);
    const after = await money([alice.houseId, bob.houseId], ELAIA);
    expect(after.held).toBe(before.held - tax.burned);
    expect(after.burned - before.burned).toBe(tax.burned);
    const lines = await linesOf('property.sale', alice.propertyId);
    expect(lines.sort((a, b) => a.amount - b.amount || a.key.localeCompare(b.key))).toEqual([
      { key: 'house', amount: -2_021 },
      { key: 'sink_market_tax', amount: tax.burned },
      { key: 'treasury', amount: tax.treasury },
      { key: 'house', amount: tax.net },
    ]);
    expect((await listingsOf(alice.propertyId)).map((row) => row.outcome)).toEqual(['sold']);
    const [event] = await eventsAbout('PropertySold', alice.propertyId);
    expect(event).toMatchObject({
      sellerHouseId: alice.houseId,
      buyerHouseId: bob.houseId,
      priceOboles: 2_021,
      netOboles: tax.net,
      burnedOboles: tax.burned,
      treasuryOboles: tax.treasury,
    });
    expect(await buyListed(bob.user, alice.propertyId, 2_021, key)).toEqual(bought);
    expect(await balanceOf(bob.houseId)).toBe(bobBefore - 2_021);
    // Le bien se revend encore : Bob le remet en vente, Alice le rachète.
    expect((await list(bob.user, alice.propertyId, 1_500)).status).toBe(200);
    expect((await buyListed(alice.user, alice.propertyId, 1_500)).status).toBe(200);
    expect((await propertyOf(alice.propertyId))?.owner_house_id).toBe(alice.houseId);
  });

  it('arrondis : une vente d’une obole va toute au puits ; sans taxe, tout au vendeur', async () => {
    const alice = await newOwner(KALLISTE);
    const bob = await newPlayer(KALLISTE);
    expect((await list(alice.user, alice.propertyId, 1)).status).toBe(200);
    const aliceBefore = await balanceOf(alice.houseId);
    expect((await buyListed(bob.user, alice.propertyId, 1)).status).toBe(200);
    expect(await balanceOf(alice.houseId)).toBe(aliceBefore);
    expect(await linesOf('property.sale', alice.propertyId)).toEqual([
      { key: 'house', amount: -1 },
      { key: 'sink_market_tax', amount: 1 },
    ]);
    const untaxed = appWithConfig((config) => ({
      ...config,
      marketTax: { rateBps: 0, burnShareBps: 5_000 },
    }));
    expect((await list(bob.user, alice.propertyId, 100)).status).toBe(200);
    await fund(alice.houseId, 100);
    expect((await buyListed(alice.user, alice.propertyId, 100, undefined, untaxed)).status).toBe(
      200,
    );
    // Les deux ventes du bien, lignes rangées par montant : la seconde, sans taxe, n'a que deux lignes.
    expect(await linesOf('property.sale', alice.propertyId)).toEqual([
      { key: 'house', amount: -100 },
      { key: 'house', amount: -1 },
      { key: 'sink_market_tax', amount: 1 },
      { key: 'house', amount: 100 },
    ]);
  });

  it('une revente et le retrait de l’offre à la fois : l’un ou l’autre, et la monnaie suit', async () => {
    const alice = await newOwner(KALLISTE);
    const bob = await newPlayer(ELAIA);
    expect((await list(alice.user, alice.propertyId, 900)).status).toBe(200);
    const bobBefore = await balanceOf(bob.houseId);
    const [bought, withdrawn] = await Promise.all([
      buyListed(bob.user, alice.propertyId, 900),
      send(alice.user, 'property.withdrawOffer', { propertyId: alice.propertyId }),
    ]);
    const sold = bought.status === 200;
    expect(sold).toBe(withdrawn.status !== 200);
    expect(codeOf(sold ? withdrawn : bought)).toBe(
      sold ? 'PROPERTY_NOT_OWNED' : 'PROPERTY_NOT_FOR_SALE',
    );
    expect((await propertyOf(alice.propertyId))?.owner_house_id).toBe(
      sold ? bob.houseId : alice.houseId,
    );
    expect(await balanceOf(bob.houseId)).toBe(sold ? bobBefore - 900 : bobBefore);
    expect(await linesOf('property.sale', alice.propertyId)).toHaveLength(sold ? 4 : 0);
  });

  it('deux maisons achètent à la fois le même bien : une seule l’obtient et paie', async () => {
    const alice = await newOwner(KALLISTE);
    const [bob, chloe] = await Promise.all([newPlayer(KALLISTE), newPlayer(ELAIA)]);
    expect((await list(alice.user, alice.propertyId, 900)).status).toBe(200);
    const replies = await Promise.all(
      [bob, chloe].map((p) => buyListed(p.user, alice.propertyId, 900)),
    );
    expect(replies.map((reply) => codeOf(reply) ?? reply.status).sort()).toEqual([
      200,
      'PROPERTY_NOT_FOR_SALE',
    ]);
    const [winner, other] = replies[0]?.status === 200 ? [bob, chloe] : [chloe, bob];
    expect((await propertyOf(alice.propertyId))?.owner_house_id).toBe(winner.houseId);
    expect(await eventsAbout('PropertySold', alice.propertyId)).toHaveLength(1);
    expect(await linesOf('property.sale', alice.propertyId)).toHaveLength(4);
    expect(codeOf(await buyListed(other.user, alice.propertyId, 900))).toBe(
      'PROPERTY_NOT_FOR_SALE',
    );
  });

  it('refus sans effet : son propre bien, prix changé, trésorerie courte, offre de location, bien inconnu', async () => {
    const alice = await newOwner(KALLISTE);
    const bob = await newPlayer(KALLISTE);
    const balance = await balanceOf(bob.houseId);
    expect((await list(alice.user, alice.propertyId, balance + 1)).status).toBe(200);
    expect(codeOf(await buyListed(alice.user, alice.propertyId, balance + 1))).toBe('OWN_PROPERTY');
    expect(codeOf(await buyListed(bob.user, alice.propertyId, balance))).toBe('PRICE_CHANGED');
    expect(codeOf(await buyListed(bob.user, alice.propertyId, balance + 1))).toBe(
      'INSUFFICIENT_FUNDS',
    );
    const landlord = await newOwner(KALLISTE);
    expect((await offerLease(landlord.user, landlord.propertyId, 40)).status).toBe(200);
    expect(codeOf(await buyListed(bob.user, landlord.propertyId, 40))).toBe(
      'PROPERTY_NOT_FOR_SALE',
    );
    expect(codeOf(await buyListed(bob.user, randomUUID(), 40))).toBe('PROPERTY_NOT_FOUND');
    expect(await balanceOf(bob.houseId)).toBe(balance);
    expect((await propertyOf(alice.propertyId))?.owner_house_id).toBe(alice.houseId);
    // Une obole de plus, et la même offre se paie.
    await fund(bob.houseId, 1);
    expect((await buyListed(bob.user, alice.propertyId, balance + 1)).status).toBe(200);
    expect(await balanceOf(bob.houseId)).toBe(0);
  });
});
