import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  buy,
  db,
  ELAIA,
  eventsOf,
  GRANT,
  KALLISTE,
  linesOf,
  newPlayer,
  newProperty,
  owner,
  propertyOf,
  sizeOf,
  withSize,
} from './property.integration-fixtures';

// Achat d'un bien à la cité, contre Supabase local. Chaque test fonde ses maisons et ses biens.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const TOWNHOUSE = sizeOf('townhouse').purchasePriceOboles;
const TENEMENT = sizeOf('tenement').purchasePriceOboles;
const SINK = 'sink_property_purchase';
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;

/** Rien n'a bougé pour la maison : trésorerie intacte, aucun événement d'achat. */
async function untouched(houseId: string, balance = GRANT) {
  expect(await balanceOf(houseId)).toBe(balance);
  expect(await eventsOf(houseId, 'PropertyBought')).toEqual([]);
}

describe('property.buy', () => {
  it('la maison paie le prix de sa taille, détruit par le puits, et le bien est à elle ; la même clé rejoue', async () => {
    const player = await newPlayer(KALLISTE);
    const propertyId = await newProperty(KALLISTE);
    const sink = await balanceOf(SINK);
    const key = randomUUID();
    const bought = await buy(player.user, propertyId, TOWNHOUSE, key);
    expect(bought).toMatchObject({
      status: 200,
      body: { data: { propertyId, cityId: KALLISTE, sizeId: 'townhouse', priceOboles: TOWNHOUSE } },
    });
    expect(bought.body.data.lot).toBeGreaterThan(0);
    expect(await propertyOf(propertyId)).toEqual({
      owner_house_id: player.houseId,
      condition: 10_000,
      acquired_with_entry: true,
    });
    expect([await balanceOf(player.houseId), await balanceOf(SINK)]).toEqual([
      GRANT - TOWNHOUSE,
      sink + TOWNHOUSE,
    ]);
    expect(await linesOf('property.buy', propertyId)).toEqual([
      { key: 'house', amount: -TOWNHOUSE },
      { key: SINK, amount: TOWNHOUSE },
    ]);
    const event = { propertyId, houseId: player.houseId, cityId: KALLISTE, sizeId: 'townhouse' };
    expect(await eventsOf(player.houseId, 'PropertyBought')).toEqual([
      { ...event, priceOboles: TOWNHOUSE },
    ]);
    // Rejeu de la même clé : même réponse, ni second paiement ni second événement.
    expect(await buy(player.user, propertyId, TOWNHOUSE, key)).toEqual(bought);
    expect(await balanceOf(player.houseId)).toBe(GRANT - TOWNHOUSE);
    expect(await eventsOf(player.houseId, 'PropertyBought')).toHaveLength(1);
  });

  it('dans n’importe quelle cité du monde : une maison de Kallistè achète à Elaia', async () => {
    const player = await newPlayer(KALLISTE);
    const propertyId = await newProperty(ELAIA);
    const bought = await buy(player.user, propertyId, TOWNHOUSE);
    expect(bought).toMatchObject({ status: 200, body: { data: { cityId: ELAIA } } });
    expect((await propertyOf(propertyId))?.owner_house_id).toBe(player.houseId);
  });

  it('deux maisons achètent à la fois le dernier bien : une seule l’obtient et paie', async () => {
    const [alice, bob] = await Promise.all([newPlayer(KALLISTE), newPlayer(ELAIA)]);
    const propertyId = await newProperty(KALLISTE);
    const sink = await balanceOf(SINK);
    const replies = await Promise.all([alice, bob].map((p) => buy(p.user, propertyId, TOWNHOUSE)));
    expect(replies.map((reply) => codeOf(reply) ?? reply.status).sort()).toEqual([
      200,
      'PROPERTY_NOT_FOR_SALE',
    ]);
    const [winner, other] = replies[0]?.status === 200 ? [alice, bob] : [bob, alice];
    expect((await propertyOf(propertyId))?.owner_house_id).toBe(winner.houseId);
    expect(await balanceOf(winner.houseId)).toBe(GRANT - TOWNHOUSE);
    await untouched(other.houseId);
    expect(await balanceOf(SINK)).toBe(sink + TOWNHOUSE);
    expect(await linesOf('property.buy', propertyId)).toHaveLength(2);
  });

  it('deux achats à la fois que la trésorerie ne couvre qu’une fois : un seul passe, sans découvert', async () => {
    const player = await newPlayer(KALLISTE);
    const pair = [await newProperty(KALLISTE), await newProperty(KALLISTE)];
    expect([GRANT >= TOWNHOUSE, GRANT < 2 * TOWNHOUSE]).toEqual([true, true]);
    const replies = await Promise.all(pair.map((id) => buy(player.user, id, TOWNHOUSE)));
    expect(replies.map((reply) => codeOf(reply) ?? reply.status).sort()).toEqual([
      200,
      'INSUFFICIENT_FUNDS',
    ]);
    expect(await balanceOf(player.houseId)).toBe(GRANT - TOWNHOUSE);
    const owners = await Promise.all(
      pair.map(async (id) => (await propertyOf(id))?.owner_house_id),
    );
    expect(owners.sort()).toEqual([player.houseId, null].sort());
  });

  it('refus sans effet : bien déjà vendu (à soi comme à un autre), trésorerie trop courte, bien inconnu', async () => {
    const player = await newPlayer(KALLISTE);
    const propertyId = await newProperty(KALLISTE);
    expect((await buy(player.user, propertyId, TOWNHOUSE)).status).toBe(200);
    expect(codeOf(await buy(player.user, propertyId, TOWNHOUSE))).toBe('PROPERTY_NOT_FOR_SALE');
    const late = await newPlayer(KALLISTE);
    expect(codeOf(await buy(late.user, propertyId, TOWNHOUSE))).toBe('PROPERTY_NOT_FOR_SALE');
    // Un immeuble de rapport coûte plus que la dotation.
    expect(TENEMENT).toBeGreaterThan(GRANT);
    const tenement = await newProperty(KALLISTE, 'tenement');
    expect(codeOf(await buy(late.user, tenement, TENEMENT))).toBe('INSUFFICIENT_FUNDS');
    expect(await buy(late.user, randomUUID(), TOWNHOUSE)).toMatchObject({
      status: 404,
      body: { error: { code: 'PROPERTY_NOT_FOUND' } },
    });
    // Un bien d'un autre monde est indiscernable d'un bien inconnu.
    const worldId = randomUUID();
    const { rows } = await sql<{ id: string }>`
      with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`n-${worldId.slice(0, 12)}`}, 'Ailleurs')),
      city as (insert into game.cities (world_id, slug, name) values (${worldId}, 'kalliste', 'Ailleurs') returning id)
      insert into game.properties (world_id, city_id, size_id, lot) select ${worldId}, id, 'townhouse', 1 from city
      returning id`.execute(owner);
    expect(codeOf(await buy(late.user, rows[0]?.id ?? '', TOWNHOUSE))).toBe('PROPERTY_NOT_FOUND');
    expect((await buy(late.user, tenement, 0)).status).toBe(400);
    expect((await propertyOf(tenement))?.owner_house_id).toBeNull();
    await untouched(late.houseId);
  });

  it('prix changé ou taille retirée : rien n’est payé, le bien reste à la cité', async () => {
    const player = await newPlayer(KALLISTE);
    const propertyId = await newProperty(KALLISTE);
    for (const seen of [TOWNHOUSE - 1, TOWNHOUSE + 1])
      expect(codeOf(await buy(player.user, propertyId, seen))).toBe('PRICE_CHANGED');
    // Une version activée entre l'affichage et le clic baisse le prix : le prix vu est refusé.
    const cheaper = withSize('townhouse', { purchasePriceOboles: TOWNHOUSE - 500 });
    expect(codeOf(await buy(player.user, propertyId, TOWNHOUSE, undefined, cheaper))).toBe(
      'PRICE_CHANGED',
    );
    const retired = withSize('townhouse', 'retired');
    expect(codeOf(await buy(player.user, propertyId, TOWNHOUSE, undefined, retired))).toBe(
      'PROPERTY_SIZE_RETIRED',
    );
    expect((await propertyOf(propertyId))?.owner_house_id).toBeNull();
    await untouched(player.houseId);
    // Au nouveau prix, sous une clé neuve, l'achat passe.
    expect((await buy(player.user, propertyId, TOWNHOUSE - 500, undefined, cheaper)).status).toBe(
      200,
    );
    expect(await balanceOf(player.houseId)).toBe(GRANT - TOWNHOUSE + 500);
  });
});
