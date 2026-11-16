import { decreeApplication } from '@oikos/engine';
import { marketTax, portDues } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { db, newWorld, owner } from './city-decree.integration-fixtures';
import { newOwner, newPlayer } from './property.integration-fixtures';
import { TEST_CONFIG } from './test-config';
import {
  appWithConfig,
  depart,
  give,
  newShipowner,
  pricedConfig,
  send,
  type App,
} from './voyage.integration-fixtures';

// Taux par cité (5.6, #262) dans les commandes qui taxent, contre Supabase local. Chaque test a son monde : un
// décret appliqué change pour de bon le taux de sa cité.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const BURN = TEST_CONFIG.config.marketTax.burnShareBps;
const RATE = TEST_CONFIG.config.marketTax.rateBps;
const BOUNDS = TEST_CONFIG.config.decrees?.models.market_tax_rate;

/** Un décret de taux appliqué dans la cité, posé garde levée comme par la clôture ; ou seulement adopté. */
async function enact(
  cityId: string,
  model: 'market_tax_rate' | 'port_dues',
  value: number,
  status: 'applied' | 'adopted' = 'applied',
) {
  const params = model === 'market_tax_rate' ? { rateBps: value } : { coefficientBps: value };
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.decrees disable trigger decrees_guard`.execute(trx);
    await sql`insert into game.decrees (world_id, city_id, model, params, office_id, proposed_by, status, proposed_at,
        voting_closes_at, quorum_bps, tallied_at, electorate, votes_for, votes_against, applied_at)
      select c.world_id, c.id, ${model}, ${JSON.stringify(params)}::jsonb, o.id, o.house_id, ${status},
        now() - interval '3 days', now() - interval '1 hour', 0, now() - interval '1 hour', 1, 1, 0,
        case when ${status} = 'applied' then now() end
      from game.cities c join game.offices o on o.world_id = c.world_id where c.id = ${cityId} limit 1`.execute(
      trx,
    );
    await sql`alter table game.decrees enable trigger decrees_guard`.execute(trx);
  });
}
/** Solde d'une trésorerie de maison, du trésor d'une cité ou du puits de la taxe d'un monde. */
const balance = async (where: { houseId: string } | { cityId: string } | { sinkOf: string }) =>
  Number(
    (
      await sql<{ balance: string }>`select balance from game.accounts where ${
        'houseId' in where
          ? sql`house_id = ${where.houseId} and kind = 'house'`
          : 'cityId' in where
            ? sql`city_id = ${where.cityId}`
            : sql`world_id = ${where.sinkOf} and system_key = 'sink_market_tax'`
      }`.execute(owner)
    ).rows[0]?.balance,
  );
/**
 * Attend qu'une autre transaction soit bloquée sur le verrou consultatif de l'agora du monde, lu dans
 * `pg_locks` (clé de 64 bits : `classid` en porte la moitié haute, `objid` la basse).
 */
async function waitingOnAgora(worldId: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { rows } = await sql<{ waiting: string }>`select count(*) as waiting
      from pg_locks l cross join (select hashtextextended(${`market:${worldId}`}, 0) as k) lock
      where l.locktype = 'advisory' and not l.granted
        and l.classid::bigint = ((lock.k >> 32) & 4294967295) and l.objid::bigint = (lock.k & 4294967295)`.execute(
      owner,
    );
    if (Number(rows[0]?.waiting) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`No transaction waits on the agora lock of world ${worldId}`);
}

describe('taxe de marché de la cité', () => {
  it('market.placeOrder : le taux du décret vaut dès l’échange suivant, dans sa cité seulement, borné par le monde', async () => {
    const world = await newWorld();
    const [seller, buyer] = [await world.player(), await world.player()];
    await give(seller.houseId, 'wheat', 100, world.kalliste);
    const elaiaSeller = await world.player(world.elaia);
    const elaiaBuyer = await world.player(world.elaia);
    await give(elaiaSeller.houseId, 'wheat', 10, world.elaia);
    type Player = { user: string; houseId: string };
    /** Une vente de 10 blés à 21 servie aussitôt dans la cité ; rend ce qu'ont reçu vendeur, trésor et puits. */
    const trade = async (
      via?: App,
      [from, to]: Player[] = [seller, buyer],
      cityId = world.kalliste,
    ) => {
      if (!from || !to) throw new Error('two players trade');
      const balances = async () => [
        await balance({ houseId: from.houseId }),
        await balance({ cityId }),
        await balance({ sinkOf: world.worldId }),
      ];
      const order = (user: string, side: string) =>
        send(
          user,
          'market.placeOrder',
          { cityId, goodId: 'wheat', side, price: 21, quantity: 10 },
          undefined,
          via,
        );
      const before = await balances();
      expect((await order(from.user, 'sell')).status).toBe(200);
      expect((await order(to.user, 'buy')).body.data.status).toBe('filled');
      const [net, treasury, burned] = (await balances()).map(
        (value, index) => value - (before[index] ?? 0),
      );
      return { net, treasury, burned };
    };
    const taxedAt = (rateBps: number) => marketTax(210, { rateBps, burnShareBps: BURN });

    expect(await trade()).toEqual(taxedAt(RATE));
    await enact(world.kalliste, 'market_tax_rate', 800);
    expect(await trade()).toEqual(taxedAt(800));
    // Elaia n'a pas voté : le taux du monde.
    expect(await trade(undefined, [elaiaSeller, elaiaBuyer], world.elaia)).toEqual(taxedAt(RATE));
    // Un décret devenu hors bornes (la configuration les a resserrées depuis) vaut la borne la plus proche.
    const narrow = appWithConfig((config) => ({
      ...config,
      decrees: config.decrees && {
        ...config.decrees,
        models: { ...config.decrees.models, market_tax_rate: { minRateBps: 200, maxRateBps: 600 } },
      },
    }));
    expect(await trade(narrow)).toEqual(taxedAt(600));
    // Un modèle que le monde ne borne plus : le taux de la configuration, le décret reste sans effet.
    const closed = appWithConfig((config) => ({
      ...config,
      decrees: config.decrees && {
        ...config.decrees,
        models: { ...config.decrees.models, market_tax_rate: undefined },
      },
    }));
    expect(await trade(closed)).toEqual(taxedAt(RATE));
    // Le décret le plus récemment appliqué l'emporte, et un taux nul ne prélève rien.
    expect(BOUNDS?.minRateBps).toBeGreaterThan(0);
    await enact(world.kalliste, 'market_tax_rate', 0);
    expect(await trade()).toEqual(taxedAt(BOUNDS?.minRateBps ?? 0));
    const zero = appWithConfig((config) => ({
      ...config,
      decrees: config.decrees && {
        ...config.decrees,
        models: { ...config.decrees.models, market_tax_rate: { minRateBps: 0, maxRateBps: 1000 } },
      },
    }));
    expect(await trade(zero)).toEqual({ net: 210, treasury: 0, burned: 0 });
  });

  it('un échange qui attend la clôture appliquant un décret paie le taux nouveau', async () => {
    const world = await newWorld();
    const [seller, buyer] = [await world.player(), await world.player()];
    await give(seller.houseId, 'wheat', 10, world.kalliste);
    const order = (user: string, side: string) =>
      send(user, 'market.placeOrder', {
        cityId: world.kalliste,
        goodId: 'wheat',
        side,
        price: 21,
        quantity: 10,
      });
    expect((await order(seller.user, 'sell')).status).toBe(200);
    const before = await balance({ houseId: seller.houseId });
    await enact(world.kalliste, 'market_tax_rate', 800, 'adopted');
    // La clôture applique le décret sous le verrou de l'agora ; l'achat arrive avant qu'elle soit validée, et
    // la base montre qu'il attend ce verrou avant que la clôture ne le relâche.
    const close = await db.startTransaction().execute();
    const step = { trx: close, worldId: world.worldId, gameDay: 0, closeAt: new Date() };
    const applied = await decreeApplication.run({ ...step, config: TEST_CONFIG.config });
    expect(applied).toEqual({ applied: 1, bounded: 0, unreadable: 0 });
    let settled = false;
    const pending = order(buyer.user, 'buy').then((reply) => ((settled = true), reply));
    await waitingOnAgora(world.worldId);
    expect(settled).toBe(false);
    await close.commit().execute();
    expect((await pending).body.data.status).toBe('filled');
    const net = marketTax(210, { rateBps: 800, burnShareBps: BURN }).net;
    expect((await balance({ houseId: seller.houseId })) - before).toBe(net);
  });

  it('property.buyListed : la revente d’un bien est taxée au taux de la cité du bien', async () => {
    const world = await newWorld();
    await enact(world.kalliste, 'market_tax_rate', 900);
    const seller = await newOwner(world.kalliste);
    const buyer = await newPlayer(world.kalliste);
    expect(
      (
        await send(seller.user, 'property.listForSale', {
          propertyId: seller.propertyId,
          priceOboles: 2_021,
        })
      ).status,
    ).toBe(200);
    const before = [
      await balance({ houseId: seller.houseId }),
      await balance({ cityId: world.kalliste }),
    ];
    const bought = await send(buyer.user, 'property.buyListed', {
      propertyId: seller.propertyId,
      expectedPriceOboles: 2_021,
    });
    expect(bought.status).toBe(200);
    const tax = marketTax(2_021, { rateBps: 900, burnShareBps: BURN });
    expect([
      (await balance({ houseId: seller.houseId })) - (before[0] ?? 0),
      (await balance({ cityId: world.kalliste })) - (before[1] ?? 0),
    ]).toEqual([tax.net, tax.treasury]);
  });
});

describe('droit de port de la cité', () => {
  it('voyage.depart : le coefficient du décret de la cité d’arrivée, le coût vu sinon refusé', async () => {
    const world = await newWorld();
    // Droit de 40 par caboteur, Elaia à ×1 dans la configuration, provisions nulles.
    const priced = appWithConfig(pricedConfig(0, 40));
    const player = await newShipowner(world.kalliste);
    const trip = { fromCityId: world.kalliste, toCityId: world.elaia, cargo: [] };
    await enact(world.elaia, 'port_dues', 15_000);
    // Le coût calculé sur la configuration seule n'est plus le bon : refusé, rien ne bouge.
    const stale = await depart(player, { ...trip, expectedCostOboles: 40 }, undefined, priced);
    expect(stale.body.error).toEqual({
      code: 'PRICE_CHANGED',
      message: 'This voyage now costs 60 oboles.',
    });
    const treasury = await balance({ cityId: world.elaia });
    const dues = portDues({ baseOboles: 40, cityCoefficientBps: 15_000, burnShareBps: 5_000 });
    const sailed = await depart(
      player,
      { ...trip, expectedCostOboles: dues.oboles },
      undefined,
      priced,
    );
    expect(sailed.body.data).toMatchObject({ portDuesOboles: 60, costOboles: 60 });
    expect((await balance({ cityId: world.elaia })) - treasury).toBe(dues.treasury);
    // Un coefficient hors des bornes du monde vaut la borne : ×2 au plus dans la configuration de test.
    const second = await newShipowner(world.kalliste);
    await enact(world.elaia, 'port_dues', 90_000);
    const capped = await depart(second, { ...trip, expectedCostOboles: 80 }, undefined, priced);
    expect(capped.body.data).toMatchObject({ portDuesOboles: 80 });
  });
});
