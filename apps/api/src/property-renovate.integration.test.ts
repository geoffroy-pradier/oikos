import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  buy,
  db,
  ELAIA,
  eventsOf,
  give,
  GRANT,
  KALLISTE,
  linesOf,
  newPlayer,
  newProperty,
  owner,
  propertyOf,
  send,
  sizeOf,
  withSize,
} from './property.integration-fixtures';
import type { App } from './voyage.integration-fixtures';

// Rénovation d'un bien, contre Supabase local. Chaque test fonde sa maison, lui achète une maison de ville
// et la pose usée ; les biens de la rénovation sont posés dans son entrepôt.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const { purchasePriceOboles: PRICE, renovation } = sizeOf('townhouse');
const WORKS = renovation.oboles;
const GOODS = [...renovation.goods].sort((a, b) => (a.goodId < b.goodId ? -1 : 1));
const SINK = 'sink_property_works';
const codeOf = (reply: { body: { error?: { code: string } } }) => reply.body.error?.code;
const renovate = (
  user: string,
  id: string,
  cost = WORKS,
  goods = GOODS,
  key?: string,
  via?: App,
) => {
  const input = { propertyId: id, expectedCostOboles: cost, expectedGoods: goods };
  return send(user, 'property.renovate', input, key, via);
};
/** Quantité libre (hors réservations) de chaque bien de la rénovation, dans la cité. */
const freeStock = async (houseId: string, cityId: string) =>
  (
    await sql<{ good_id: string; free: string }>`select good_id, quantity - reserved as free
      from game.inventories where house_id = ${houseId} and city_id = ${cityId}
      and good_id = any(${GOODS.map((entry) => entry.goodId)})
      order by good_id collate "C"`.execute(db)
  ).rows.map((row) => [row.good_id, Number(row.free)]);

/**
 * Une maison de Kallistè propriétaire d'une maison de ville de `cityId` à l'état `condition`, avec
 * `stock` fois les biens de la rénovation dans son entrepôt de `cityId`. L'usure est posée par le
 * propriétaire de la base, garde levée le temps de l'écrire : seule une clôture use un bien.
 */
async function worn(condition: number, stock = 1, cityId: string = KALLISTE) {
  const player = await newPlayer(KALLISTE);
  const propertyId = await newProperty(cityId);
  expect((await buy(player.user, propertyId, PRICE)).status).toBe(200);
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.properties disable trigger properties_guard`.execute(trx);
    await sql`update game.properties set condition = ${condition}
      where id = ${propertyId}`.execute(trx);
    await sql`alter table game.properties enable trigger properties_guard`.execute(trx);
  });
  // La dotation est passée dans l'achat : la maison reçoit de quoi payer deux rénovations.
  await sql`with entry as (insert into game.ledger_entries (world_id, kind)
      select world_id, 'test.seed' from game.houses where id = ${player.houseId} returning id, world_id)
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry.id, a.id, case when a.kind = 'house' then ${2 * WORKS}::bigint else ${-2 * WORKS}::bigint end
    from entry join game.accounts a on a.world_id = entry.world_id
    where (a.kind = 'house' and a.house_id = ${player.houseId})
      or a.system_key = 'faucet_starting_grant'`.execute(owner);
  if (stock > 0)
    for (const { goodId, quantity } of GOODS)
      await give(player.houseId, goodId, stock * quantity, cityId);
  return { ...player, propertyId, balance: GRANT - PRICE + 2 * WORKS };
}

describe('property.renovate', () => {
  it('le bien redevient neuf ; le coût est détruit, les biens consommés, dans une transaction', async () => {
    const owned = await worn(2_500, 2);
    const sink = await balanceOf(SINK);
    const key = randomUUID();
    const done = await renovate(owned.user, owned.propertyId, WORKS, [...GOODS].reverse(), key);
    expect(done).toMatchObject({
      status: 200,
      body: {
        data: { propertyId: owned.propertyId, costOboles: WORKS, goods: GOODS, condition: 10_000 },
      },
    });
    expect((await propertyOf(owned.propertyId))?.condition).toBe(10_000);
    expect([await balanceOf(owned.houseId), await balanceOf(SINK)]).toEqual([
      owned.balance - WORKS,
      sink + WORKS,
    ]);
    expect(await linesOf('property.renovate', owned.propertyId)).toEqual([
      { key: 'house', amount: -WORKS },
      { key: SINK, amount: WORKS },
    ]);
    // Le débit est marqué entretien (4.1) ; les biens partent à la consommation, rattachés à l'écriture.
    const marked = await sql<{ nature: string | null; moved: string }>`
      select l.nature, (select string_agg(s.good_id || ':' || s.quantity || ':' || s.to_system, ' ' order by s.good_id)
        from game.stock_ledger s where s.ledger_entry_id = e.id and s.kind = 'property.renovate') as moved
      from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
      where e.kind = 'property.renovate' and e.meta->>'propertyId' = ${owned.propertyId} and l.amount < 0`.execute(
      db,
    );
    expect(marked.rows).toEqual([
      {
        nature: 'upkeep',
        moved: GOODS.map((entry) => `${entry.goodId}:${entry.quantity}:consumption`).join(' '),
      },
    ]);
    expect(await freeStock(owned.houseId, KALLISTE)).toEqual(
      GOODS.map((entry) => [entry.goodId, entry.quantity]),
    );
    expect(await eventsOf(owned.houseId, 'PropertyRenovated')).toEqual([
      {
        propertyId: owned.propertyId,
        houseId: owned.houseId,
        cityId: KALLISTE,
        sizeId: 'townhouse',
        costOboles: WORKS,
        goods: GOODS,
        conditionBefore: 2_500,
      },
    ]);
    // Rejeu de la même clé : même réponse, rien de plus payé ni consommé.
    expect(await renovate(owned.user, owned.propertyId, WORKS, [...GOODS].reverse(), key)).toEqual(
      done,
    );
    expect(await balanceOf(owned.houseId)).toBe(owned.balance - WORKS);
    // Neuf, il n'y a plus rien à rénover.
    expect(codeOf(await renovate(owned.user, owned.propertyId))).toBe('NOTHING_TO_RENOVATE');
  });

  it('sans les biens requis, libres, dans la cité du bien, rien n’est payé ni consommé', async () => {
    // Les biens sont à Kallistè, le bien à Elaia : ils ne comptent pas.
    const owned = await worn(1_000, 0, ELAIA);
    for (const { goodId, quantity } of GOODS) await give(owned.houseId, goodId, quantity, KALLISTE);
    expect(codeOf(await renovate(owned.user, owned.propertyId))).toBe('INSUFFICIENT_STOCK');
    // Un bien sur deux à Elaia, et pas en entier : toujours refusé.
    const [first, second] = GOODS;
    if (!first || !second) throw new Error('the townhouse works need two goods');
    await give(owned.houseId, first.goodId, first.quantity, ELAIA);
    await give(owned.houseId, second.goodId, second.quantity - 1, ELAIA);
    expect(codeOf(await renovate(owned.user, owned.propertyId))).toBe('INSUFFICIENT_STOCK');
    // Tout est là, mais une unité est réservée par une vente en attente (4.5 : hors réservations).
    await give(owned.houseId, second.goodId, 1, ELAIA);
    const sale = { cityId: ELAIA, goodId: first.goodId, side: 'sell', price: 999, quantity: 1 };
    expect((await send(owned.user, 'market.placeOrder', sale)).status).toBe(200);
    expect(codeOf(await renovate(owned.user, owned.propertyId))).toBe('INSUFFICIENT_STOCK');
    expect([
      (await propertyOf(owned.propertyId))?.condition,
      await balanceOf(owned.houseId),
    ]).toEqual([1_000, owned.balance]);
    expect(await freeStock(owned.houseId, ELAIA)).toEqual([
      [first.goodId, first.quantity - 1],
      [second.goodId, second.quantity],
    ]);
    expect(await linesOf('property.renovate', owned.propertyId)).toEqual([]);
    expect(await eventsOf(owned.houseId, 'PropertyRenovated')).toEqual([]);
  });

  it('refus sans effet : bien d’un autre ou de la cité, coût changé, taille retirée, trésorerie trop courte', async () => {
    const owned = await worn(4_000);
    const stranger = await newPlayer(KALLISTE);
    expect(codeOf(await renovate(stranger.user, owned.propertyId))).toBe('PROPERTY_NOT_OWNED');
    expect(codeOf(await renovate(owned.user, await newProperty(KALLISTE)))).toBe(
      'PROPERTY_NOT_OWNED',
    );
    expect(codeOf(await renovate(owned.user, randomUUID()))).toBe('PROPERTY_NOT_FOUND');
    const [first] = GOODS;
    if (!first) throw new Error('the townhouse works need goods');
    for (const [cost, goods] of [
      [WORKS + 1, GOODS],
      [WORKS, GOODS.slice(1)],
      [WORKS, GOODS.map((entry) => ({ ...entry, quantity: entry.quantity + 1 }))],
    ] as const)
      expect(codeOf(await renovate(owned.user, owned.propertyId, cost, goods))).toBe(
        'PRICE_CHANGED',
      );
    // Une version activée entre l'affichage et le clic change les biens : le coût vu est refusé.
    const cheaper = withSize('townhouse', { renovation: { oboles: WORKS, goods: [first] } });
    expect(
      codeOf(await renovate(owned.user, owned.propertyId, WORKS, GOODS, undefined, cheaper)),
    ).toBe('PRICE_CHANGED');
    const retired = withSize('townhouse', 'retired');
    expect(
      codeOf(await renovate(owned.user, owned.propertyId, WORKS, GOODS, undefined, retired)),
    ).toBe('PROPERTY_SIZE_RETIRED');
    const dear = withSize('townhouse', { renovation: { oboles: owned.balance + 1, goods: GOODS } });
    expect(
      codeOf(
        await renovate(owned.user, owned.propertyId, owned.balance + 1, GOODS, undefined, dear),
      ),
    ).toBe('INSUFFICIENT_FUNDS');
    expect((await propertyOf(owned.propertyId))?.condition).toBe(4_000);
    expect(await balanceOf(owned.houseId)).toBe(owned.balance);
    expect(await eventsOf(owned.houseId, 'PropertyRenovated')).toEqual([]);
  });

  it('deux rénovations à la fois du même bien : une seule paie et consomme', async () => {
    const owned = await worn(500, 2);
    const replies = await Promise.all([
      renovate(owned.user, owned.propertyId),
      renovate(owned.user, owned.propertyId),
    ]);
    expect(replies.map((reply) => codeOf(reply) ?? reply.status).sort()).toEqual([
      200,
      'NOTHING_TO_RENOVATE',
    ]);
    expect(await balanceOf(owned.houseId)).toBe(owned.balance - WORKS);
    expect(await freeStock(owned.houseId, KALLISTE)).toEqual(
      GOODS.map((entry) => [entry.goodId, entry.quantity]),
    );
  });
});
