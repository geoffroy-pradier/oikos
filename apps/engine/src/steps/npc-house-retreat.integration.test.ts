import { randomUUID } from 'node:crypto';
import type { GameConfig, NpcHouses, NpcRetreat } from '@oikos/config';
import { placeOrder } from '@oikos/operations';
import { dailyCloseAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runNpcHouseRules } from '../npc-house-rules';
import { npcHouseRetreatStep } from './npc-house-retreat';
import { npcHouses } from './npc-houses';
import { laborMarket } from './labor-market';
import { siteUpkeep } from './site-upkeep';
import {
  clock,
  close,
  configWith,
  credit,
  db,
  DAY,
  newWorld,
  npcHouseOf,
  owner,
  setUp,
  startAfterClose,
  tearDown,
} from './npc-houses.integration-fixtures';

// Retrait des maisons PNJ de secours devant les joueurs (#717), contre Supabase local. Chaque test a son monde : à
// Kallistè, la maison PNJ « Greniers » tient le blé ; Alcméonides vend du blé, Bouzyges en achète.
let versionId = '';
beforeAll(async () => {
  versionId = (await setUp()).id;
});
afterAll(tearDown);

/** Retrait à chaque clôture : au-dessus de 80 % des ventes depuis une clôture, la maison ferme ; sous 40 %, elle rouvre. */
const RETREAT: NpcRetreat = { highShareBps: 8_000, lowShareBps: 4_000, windowDays: 1, days: 1 };
const secours = (fields = 2): NpcHouses => ({
  kalliste: {
    treasuryCapOboles: 20_000,
    chains: [
      {
        id: 'wheat',
        name: 'Greniers',
        sites: { grow_wheat: fields },
        grantOboles: 1_000,
        goodId: 'wheat',
      },
    ],
  },
});
const more = (retreat: NpcRetreat = RETREAT): Partial<GameConfig> => ({ npcRetreat: retreat });
const steps = [npcHouses, npcHouseRetreatStep];
const D = DAY - 2;

/** Une maison de joueur de la cité, avec sa trésorerie. */
async function playerHouse(worldId: string, cityId: string, name: string, oboles: number) {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const { rows } = await sql<{
    id: string;
  }>`insert into game.houses (world_id, user_id, name, blazon)
    values (${worldId}, ${user}, ${name}, '{}') returning id`.execute(owner);
  const houseId = rows[0]?.id ?? '';
  const account = await sql<{ id: string }>`insert into game.accounts (world_id, kind, house_id)
    values (${worldId}, 'house', ${houseId}) returning id`.execute(owner);
  if (oboles > 0) await credit(worldId, account.rows[0]?.id ?? '', oboles);
  return houseId;
}
/** Récolte de blé portée au stock d'une maison. */
async function harvest(worldId: string, houseId: string, cityId: string, quantity: number) {
  await sql`insert into game.inventories (world_id, house_id, city_id, good_id)
    values (${worldId}, ${houseId}, ${cityId}, 'wheat') on conflict do nothing`.execute(owner);
  await sql`insert into game.stock_ledger (world_id, good_id, quantity, kind, from_system, to_inventory_id)
    select ${worldId}, 'wheat', ${quantity}, 'test.harvest', 'production', id from game.inventories
    where house_id = ${houseId} and city_id = ${cityId} and good_id = 'wheat'`.execute(owner);
}
/** Un ordre de blé posé par le cœur de la commande, au nom de la maison, à 6 oboles par défaut. */
const order = (
  houseId: string,
  cityId: string,
  side: 'buy' | 'sell',
  quantity: number,
  price = 6,
) =>
  db.transaction().execute(async (trx) => {
    const placed = await placeOrder.run(
      { trx, emit: () => {}, config: configWith(secours(), more()), now: new Date() },
      { houseId },
      { cityId, goodId: 'wheat', side, price, quantity },
    );
    if (!placed.ok) throw new Error(placed.error.code);
  });
/** Bouzyges achète, puis chaque vendeur vend ce qu'on lui donne : des échanges de blé à l'agora de Kallistè. */
async function trade(
  world: { worldId: string; cityId: string; buyer: string },
  sales: [houseId: string, quantity: number][],
) {
  const total = sales.reduce((sum, [, quantity]) => sum + quantity, 0);
  await order(world.buyer, world.cityId, 'buy', total);
  for (const [houseId, quantity] of sales) {
    await harvest(world.worldId, houseId, world.cityId, quantity);
    await order(houseId, world.cityId, 'sell', quantity);
  }
}
/** Sites de la maison PNJ, dans l'ordre de création, et sa mémoire du retrait. */
async function stateOf(houseId: string) {
  const { rows: sites } = await sql<{
    id: string;
    closed: boolean;
  }>`select id, closed_at is not null as closed
    from game.sites where house_id = ${houseId} order by created_at, id`.execute(owner);
  const { rows } = await sql<{
    game_day: number;
    sales: number[][];
    above_days: number;
    dissolved: boolean;
  }>`
    select game_day, sales, above_days, dissolved_at is not null as dissolved from game.npc_house_retreats
    where house_id = ${houseId}`.execute(owner);
  return { sites, memory: rows[0] };
}
const eventsOf = async (worldId: string, type: string) =>
  (
    await sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = ${type} and payload->>'worldId' = ${worldId} order by seq`.execute(owner)
  ).rows.map((row) => row.payload);

/** Un monde fondé à la clôture `D` : la maison PNJ, ses sites datés d'après cette clôture, et les deux joueurs. */
async function founded(fields = 2) {
  const { worldId, cityIds } = await newWorld(['kalliste']);
  const cityId = cityIds['kalliste'] ?? '';
  expect(await close(worldId, D, secours(fields), steps, more())).toEqual([D]);
  await startAfterClose(worldId, D);
  const npc = await npcHouseOf(worldId, cityId);
  const seller = await playerHouse(worldId, cityId, 'Alcméonides', 0);
  const buyer = await playerHouse(worldId, cityId, 'Bouzyges', 100_000);
  return { worldId, cityId, npc, seller, buyer };
}

describe('retrait des maisons PNJ de secours (#717)', () => {
  it('des joueurs qui tiennent le marché font se retirer la maison PNJ, qui revient quand ils cessent de vendre', async () => {
    const world = await founded();
    // La première clôture ne fait que poser la mémoire, après les échanges déjà inscrits.
    expect((await stateOf(world.npc.houseId)).memory).toMatchObject({
      game_day: D,
      sales: [],
      above_days: 0,
    });
    // Les joueurs vendent 90 blés, la maison PNJ 10 : 90 % des ventes.
    await trade(world, [
      [world.seller, 90],
      [world.npc.houseId, 10],
    ]);
    expect(await close(world.worldId, D + 1, secours(), steps, more())).toEqual([D + 1]);
    let state = await stateOf(world.npc.houseId);
    expect(state.sites.map((site) => site.closed)).toEqual([false, true]);
    expect(state.memory).toMatchObject({ game_day: D + 1, sales: [[90, 100]], above_days: 1 });
    expect(await eventsOf(world.worldId, 'NpcHouseRetreated')).toEqual([
      {
        houseId: world.npc.houseId,
        worldId: world.worldId,
        cityId: world.cityId,
        chainId: 'wheat',
        siteId: state.sites[1]?.id,
        shareBps: 9_000,
        openSites: 1,
        gameDay: D + 1,
      },
    ]);
    // Rejouée pour le même jour, l'étape ne compte ni ne ferme rien de plus.
    const again = await db.transaction().execute((trx) =>
      npcHouseRetreatStep.run({
        trx,
        worldId: world.worldId,
        gameDay: D + 1,
        closeAt: dailyCloseAt(D + 1, clock),
        config: configWith(secours(), more()),
      }),
    );
    expect(again).toMatchObject({ houses: 0, retreated: 0, returned: 0 });
    expect(await stateOf(world.npc.houseId)).toEqual(state);
    // Les joueurs cessent de vendre : aucune vente, la maison PNJ rouvre son site, sur un cycle neuf.
    expect(await close(world.worldId, D + 2, secours(), steps, more())).toEqual([D + 2]);
    state = await stateOf(world.npc.houseId);
    expect(state.sites.map((site) => site.closed)).toEqual([false, false]);
    expect(state.memory).toMatchObject({ sales: [[0, 0]], above_days: 0 });
    const returned = await eventsOf(world.worldId, 'NpcHouseReturned');
    expect(returned).toMatchObject([
      { siteId: state.sites[1]?.id, shareBps: 0, openSites: 2, gameDay: D + 2 },
    ]);
    const { rows } = await sql<{
      fresh: boolean;
    }>`select cycle_started_at > ${dailyCloseAt(D + 2, clock)} as fresh
      from game.sites where id = ${state.sites[1]?.id ?? ''}`.execute(owner);
    expect(rows).toEqual([{ fresh: true }]);
  });

  it('entre les seuils, rien ne bouge ; sans section `npcRetreat`, rien ne se retire', async () => {
    const world = await founded();
    await trade(world, [
      [world.seller, 60],
      [world.npc.houseId, 40],
    ]);
    expect(await close(world.worldId, D + 1, secours(), steps, more())).toEqual([D + 1]);
    expect((await stateOf(world.npc.houseId)).sites.map((site) => site.closed)).toEqual([
      false,
      false,
    ]);
    await trade(world, [[world.seller, 100]]);
    expect(await close(world.worldId, D + 2, secours(), steps, { npcRetreat: undefined })).toEqual([
      D + 2,
    ]);
    const state = await stateOf(world.npc.houseId);
    expect(state.sites.map((site) => site.closed)).toEqual([false, false]);
    // La mémoire n'a pas bougé : la version sans retrait ne compte rien.
    expect(state.memory).toMatchObject({ game_day: D + 1, sales: [[60, 100]] });
  });

  it('un site fermé ce jour n’emploie personne et ne doit pas d’entretien', async () => {
    const world = await founded(3);
    await trade(world, [[world.seller, 100]]);
    const all = [npcHouseRetreatStep, laborMarket, npcHouses, siteUpkeep];
    expect(await close(world.worldId, D + 1, secours(3), all, more())).toEqual([D + 1]);
    const state = await stateOf(world.npc.houseId);
    expect(state.sites.map((site) => site.closed)).toEqual([false, false, true]);
    // Le marché du travail du jour ne compte que les deux champs ouverts, quatre travailleurs chacun.
    const { rows } = await sql<{ employed: number }>`select employed::int from game.labor_market
      where world_id = ${world.worldId} and game_day = ${D + 1}`.execute(owner);
    expect(rows).toEqual([{ employed: 8 }]);
    const { rows: upkeep } = await sql<{ payload: Record<string, unknown> }>`select payload
      from game.domain_events where type = 'UpkeepSettled' and payload->>'houseId' = ${world.npc.houseId}`.execute(
      owner,
    );
    const settled = upkeep[0]?.payload;
    expect((settled?.['paid'] as { siteId: string }[]).map((due) => due.siteId)).toEqual(
      state.sites.slice(0, 2).map((site) => site.id),
    );
    expect(settled?.['unpaid']).toEqual([]);
  });

  it('sans site, elle vend son stock au prix de référence, verse sa trésorerie au puits, puis se dissout', async () => {
    const world = await founded(1);
    // Un achat en attente, sous séquestre, et du blé en stock, que la liquidation va annuler et vendre.
    await order(world.npc.houseId, world.cityId, 'buy', 5, 5);
    await harvest(world.worldId, world.npc.houseId, world.cityId, 7);
    await trade(world, [[world.seller, 100]]);
    expect(await close(world.worldId, D + 1, secours(1), steps, more())).toEqual([D + 1]);
    let state = await stateOf(world.npc.houseId);
    expect(state.sites.map((site) => site.closed)).toEqual([true]);
    expect(state.memory?.dissolved).toBe(false);
    const { rows: orders } = await sql<{
      side: string;
      status: string;
      price: number;
      remaining: number;
    }>`
      select side, status, price::int, remaining::int from game.orders where house_id = ${world.npc.houseId}
      order by created_at`.execute(owner);
    expect(orders).toEqual([
      { side: 'buy', status: 'cancelled', price: 5, remaining: 5 },
      { side: 'sell', status: 'open', price: 6, remaining: 7 },
    ]);
    // Toute la dotation est revenue à la trésorerie, rien au séquestre.
    expect((await npcHouseOf(world.worldId, world.cityId)).balance).toBe(1_000);
    // Les joueurs tiennent toujours le marché ; un acheteur prend le blé de la maison PNJ.
    await trade(world, [[world.seller, 100]]);
    await order(world.buyer, world.cityId, 'buy', 7);
    expect(await close(world.worldId, D + 2, secours(1), steps, more())).toEqual([D + 2]);
    state = await stateOf(world.npc.houseId);
    expect(state.memory?.dissolved).toBe(true);
    // 1 000 de dotation, plus 7 blés à 6 oboles, moins la taxe de marché : tout au puits, rien ne reste.
    const { rows } = await sql<Record<'sink' | 'house' | 'total' | 'entries', string>>`select
      (select balance from game.accounts where world_id = ${world.worldId} and system_key = 'sink_npc_house_surplus') as sink,
      (select coalesce(sum(balance), 0) from game.accounts where house_id = ${world.npc.houseId}) as house,
      (select sum(balance) from game.accounts where world_id = ${world.worldId}) as total,
      (select count(*) from game.ledger_entries where world_id = ${world.worldId} and kind = 'npc_house.dissolution') as entries`.execute(
      owner,
    );
    const [dissolved] = await eventsOf(world.worldId, 'NpcHouseDissolved');
    expect(dissolved).toMatchObject({
      houseId: world.npc.houseId,
      chainId: 'wheat',
      gameDay: D + 2,
    });
    expect(Number(rows[0]?.sink)).toBe(dissolved?.['oboles']);
    expect(Number(rows[0]?.sink)).toBeGreaterThan(1_000);
    expect(Number(rows[0]?.sink)).toBeLessThanOrEqual(1_042);
    expect(rows[0]).toMatchObject({ house: '0', total: '0', entries: '1' });
    // Dissoute, elle ne compte plus rien, et une clôture de plus ne la touche pas.
    expect(await close(world.worldId, D + 3, secours(1), steps, more())).toEqual([D + 3]);
    expect((await stateOf(world.npc.houseId)).memory).toMatchObject({
      game_day: D + 2,
      dissolved: true,
    });
    expect(await eventsOf(world.worldId, 'NpcHouseDissolved')).toHaveLength(1);
  });

  it('sous des échanges concurrents, chaque vente est comptée une fois, ni perdue ni doublée', async () => {
    const world = await founded();
    const window = more({ ...RETREAT, windowDays: 3, highShareBps: 9_999, lowShareBps: 0 });
    await trade(world, [[world.seller, 10]]);
    // La clôture et des échanges en même temps : les uns comptent pour ce jour, les autres pour le suivant.
    await Promise.all([
      close(world.worldId, D + 1, secours(), steps, window),
      trade(world, [[world.seller, 20]]),
      trade(world, [[world.npc.houseId, 5]]),
    ]);
    expect(await close(world.worldId, D + 2, secours(), steps, window)).toEqual([D + 2]);
    const { memory } = await stateOf(world.npc.houseId);
    const counted = (memory?.sales ?? []).reduce(
      (sum, [player = 0, total = 0]) => [(sum[0] ?? 0) + player, (sum[1] ?? 0) + total],
      [0, 0],
    );
    expect(counted).toEqual([30, 35]);
  });

  it('un site fermé ne mène aucune de ses règles, même avec du stock à vendre', async () => {
    const world = await founded();
    // Des règles de vente pour les champs, et du blé en stock ; les deux champs sont fermés.
    const ruled = secours();
    const chain = ruled['kalliste']?.chains[0];
    if (chain)
      chain.rules = {
        grow_wheat: [{ kind: 'sell', goodId: 'wheat', minPriceOboles: 6, keepUnits: 0 }],
      };
    await harvest(world.worldId, world.npc.houseId, world.cityId, 20);
    await sql`update game.sites set closed_at = now() where house_id = ${world.npc.houseId}`.execute(
      owner,
    );
    const tick = (index: number) => ({
      worldId: world.worldId,
      index,
      configVersionId: versionId,
      config: configWith(ruled, more()),
    });
    const index = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);
    expect(await runNpcHouseRules(db, tick(index))).toEqual({ acted: 0, refused: 0, failed: 0 });
    const { rows } = await sql<{ orders: number; queues: number }>`select
      (select count(*)::int from game.orders where house_id = ${world.npc.houseId}) as orders,
      (select count(*)::int from game.npc_site_queues where house_id = ${world.npc.houseId}) as queues`.execute(
      owner,
    );
    expect(rows).toEqual([{ orders: 0, queues: 0 }]);
    // Rouvert, le même champ vend au tick suivant : c'est bien la fermeture qui le retenait.
    await sql`update game.sites set closed_at = null, cycle_started_at = now()
      where id = (select id from game.sites where house_id = ${world.npc.houseId} order by created_at, id limit 1)`.execute(
      owner,
    );
    expect((await runNpcHouseRules(db, tick(index + 1))).acted).toBe(1);
  });
});
