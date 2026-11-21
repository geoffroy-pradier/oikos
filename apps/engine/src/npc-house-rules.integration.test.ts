import type { NpcHouses } from '@oikos/config';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runNpcHouseRules } from './npc-house-rules';
import {
  close,
  configWith,
  DAY,
  newWorld,
  owner,
  db,
  setUp,
  tearDown,
} from './steps/npc-houses.integration-fixtures';
import { runAllStewards } from './stewards';

// Règles des maisons PNJ de secours menées par le moteur (#716), contre Supabase local. Chaque test a son monde, fondé
// par la clôture : un champ de blé (40 blés par cycle de 240 minutes) et un moulin (10 blés pour 8 farines, 60 minutes).
let versionId = '';
beforeAll(async () => {
  versionId = (await setUp()).id;
});
afterAll(tearDown);

const FIELD = [
  { kind: 'collect' },
  { kind: 'sell', goodId: 'wheat', minPriceOboles: 6, keepUnits: 0 },
] as const;
const MILL = [
  { kind: 'buy', goodId: 'wheat', maxPriceOboles: 6, targetUnits: 20 },
  { kind: 'collect' },
  { kind: 'sell', goodId: 'flour', minPriceOboles: 10, keepUnits: 0 },
] as const;
/** Kallistè : « Moissons » tient le champ, « Moulins » le moulin, avec leur dotation. */
const secours = (millGrant = 5_000): NpcHouses => ({
  kalliste: {
    treasuryCapOboles: 20_000,
    chains: [
      {
        id: 'wheat',
        name: 'Moissons',
        sites: { grow_wheat: 1 },
        grantOboles: 5_000,
        rules: { grow_wheat: [...FIELD] },
      },
      {
        id: 'flour',
        name: 'Moulins',
        sites: { mill_flour: 1 },
        grantOboles: millGrant,
        rules: { mill_flour: [...MILL] },
      },
    ],
  },
});
let nextIndex = 8_000_000_000 + Math.floor(Math.random() * 1_000_000) * 100;
/** Un tick neuf du monde, sous la configuration d'essai et ces maisons PNJ. */
const tickOf = (worldId: string, npc: NpcHouses, index = (nextIndex += 1)) => ({
  worldId,
  index,
  configVersionId: versionId,
  config: configWith(npc),
});

/**
 * Fonde les maisons PNJ du monde ; le champ a fini son premier cycle (250 minutes), le moulin ses deux premiers (130),
 * et le champ, plus ancien, passe le premier à chaque tick (garde de la base levée).
 */
async function founded(npc: NpcHouses) {
  const { worldId } = await newWorld(['kalliste']);
  expect(await close(worldId, DAY, npc)).toEqual([DAY]);
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = now() - age, cycle_started_at = now() - age
      from (select case when recipe_id = 'grow_wheat' then interval '250 minutes' else interval '130 minutes' end as age,
                   id as site_id from game.sites where world_id = ${worldId}) a
      where id = a.site_id`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
  return { worldId };
}
/** Stocks, ordres, échanges et files des maisons PNJ du monde, par nom de maison. */
async function stateOf(worldId: string) {
  const { rows: stocks } = await sql<{ name: string; good_id: string; quantity: number }>`
    select h.name, i.good_id, i.quantity::int as quantity from game.inventories i join game.houses h on h.id = i.house_id
    where i.world_id = ${worldId} and i.quantity > 0 order by h.name, i.good_id`.execute(owner);
  const { rows: orders } = await sql<{
    name: string;
    side: string;
    good_id: string;
    price: number;
    quantity: number;
    remaining: number;
    steward_id: string | null;
  }>`select h.name, o.side, o.good_id, o.price::int as price, o.quantity::int as quantity,
      o.remaining::int as remaining, o.steward_id
    from game.orders o join game.houses h on h.id = o.house_id
    where o.world_id = ${worldId} order by h.name, o.created_at`.execute(owner);
  const { rows: trades } = await sql<{ good_id: string; price: number; quantity: number }>`
    select o.good_id, t.price::int as price, t.quantity::int as quantity from game.trades t
    join game.orders o on o.id = t.sell_order_id
    where t.world_id = ${worldId} order by t.seq`.execute(owner);
  const { rows: queues } = await sql<{
    name: string;
    rank: number;
    rule_position: number;
    error_code: string | null;
  }>`select h.name, q.rank, q.rule_position, q.error_code from game.npc_site_queues q
    join game.houses h on h.id = q.house_id where q.world_id = ${worldId} order by h.name`.execute(
    owner,
  );
  return { stocks, orders, trades, queues };
}

describe('règles des maisons PNJ de secours (#716)', () => {
  it('le champ récolte puis vend au prix de référence ; le moulin achète son intrant, mouline et vend sa farine', async () => {
    const { worldId } = await founded(secours());
    const step = () => runNpcHouseRules(db, tickOf(worldId, secours()));
    const acted = (n: number) => ({ acted: n, refused: 0, failed: 0 });
    // Tick 1 : le champ récolte 40 blés ; le moulin pose son achat de 20 blés à 6, sous séquestre, faute de vendeur.
    expect(await step()).toEqual(acted(2));
    // Tick 2 : le champ vend ses 40 blés à 6, prix de référence, dont 20 au moulin ; le moulin moud ses deux cycles.
    expect(await step()).toEqual(acted(2));
    // Tick 3 : le champ n'a plus rien à faire ; le moulin met ses 16 farines en vente à 10.
    expect(await step()).toEqual(acted(1));
    // Tick 4 : son blé moulu, le moulin rachète 20 blés, servis par le reste de la vente du champ.
    expect(await step()).toEqual(acted(1));
    const state = await stateOf(worldId);
    expect(state.trades).toEqual([
      { good_id: 'wheat', price: 6, quantity: 20 },
      { good_id: 'wheat', price: 6, quantity: 20 },
    ]);
    expect(state.orders).toEqual([
      // Rien n'est signé d'un intendant : une maison PNJ n'en a pas.
      {
        name: 'Moissons',
        side: 'sell',
        good_id: 'wheat',
        price: 6,
        quantity: 40,
        remaining: 0,
        steward_id: null,
      },
      {
        name: 'Moulins',
        side: 'buy',
        good_id: 'wheat',
        price: 6,
        quantity: 20,
        remaining: 0,
        steward_id: null,
      },
      {
        name: 'Moulins',
        side: 'sell',
        good_id: 'flour',
        price: 10,
        quantity: 16,
        remaining: 16,
        steward_id: null,
      },
      {
        name: 'Moulins',
        side: 'buy',
        good_id: 'wheat',
        price: 6,
        quantity: 20,
        remaining: 0,
        steward_id: null,
      },
    ]);
    expect(state.stocks).toEqual([
      { name: 'Moulins', good_id: 'flour', quantity: 16 },
      { name: 'Moulins', good_id: 'wheat', quantity: 20 },
    ]);
    // Partie double : le blé payé passe d'une trésorerie à l'autre, taxe de marché comprise ; la masse ne change pas.
    const { rows } = await sql<{ total: string; minted: string }>`select sum(balance) as total,
        sum(balance) filter (where system_key like 'faucet\\_%') as minted
      from game.accounts where world_id = ${worldId}`.execute(owner);
    expect(rows[0]).toEqual({ total: '0', minted: '-10000' });
  });

  it('une version sans règles, ou des règles retirées, ne fait plus rien ; rejouer un tick ne double rien', async () => {
    const { worldId } = await founded(secours());
    const tick = tickOf(worldId, secours());
    expect((await runNpcHouseRules(db, tick)).acted).toBe(2);
    const before = await stateOf(worldId);
    // Le même tick, rejoué, puis mené par deux moteurs à la fois : chaque rang est déjà mené.
    expect(await runNpcHouseRules(db, tick)).toEqual({ acted: 0, refused: 0, failed: 0 });
    await Promise.all([runNpcHouseRules(db, tick), runNpcHouseRules(db, tick)]);
    expect(await stateOf(worldId)).toEqual(before);
    const none = secours();
    for (const chain of none['kalliste']?.chains ?? []) delete chain.rules;
    expect(await runNpcHouseRules(db, tickOf(worldId, none))).toEqual({
      acted: 0,
      refused: 0,
      failed: 0,
    });
    expect(await stateOf(worldId)).toEqual(before);
  });

  it('deux moteurs sur un tick neuf : chaque rang n’est mené qu’une fois', async () => {
    const { worldId } = await founded(secours());
    const tick = tickOf(worldId, secours());
    const runs = await Promise.all([runNpcHouseRules(db, tick), runNpcHouseRules(db, tick)]);
    expect(runs.reduce((sum, run) => sum + run.acted, 0)).toBe(2);
    const state = await stateOf(worldId);
    expect(state.orders.map((order) => [order.name, order.side])).toEqual([['Moulins', 'buy']]);
    expect(state.stocks).toEqual([{ name: 'Moissons', good_id: 'wheat', quantity: 40 }]);
  });

  it('une règle refusée (trésorerie vide) se repose sans retenir les suivantes, et n’a aucun effet', async () => {
    // Le moulin n'a pas de dotation : son achat est refusé, sans effet ; il n'a pas de blé à moudre.
    const { worldId } = await founded(secours(0));
    const first = tickOf(worldId, secours(0));
    expect(await runNpcHouseRules(db, first)).toEqual({ acted: 1, refused: 1, failed: 0 });
    let state = await stateOf(worldId);
    expect(state.queues).toEqual([
      { name: 'Moissons', rank: 0, rule_position: 0, error_code: null },
      { name: 'Moulins', rank: 0, rule_position: 0, error_code: 'INSUFFICIENT_FUNDS' },
    ]);
    expect(state.orders).toEqual([]);
    // Tick 2 : le champ vend ; le moulin, à la règle suivante de sa file, tente de moudre sans blé, refusé.
    expect(await runNpcHouseRules(db, tickOf(worldId, secours(0)))).toEqual({
      acted: 1,
      refused: 1,
      failed: 0,
    });
    const rested = (await stateOf(worldId)).queues;
    expect(rested).toEqual([
      { name: 'Moissons', rank: 0, rule_position: 1, error_code: null },
      { name: 'Moulins', rank: 0, rule_position: 1, error_code: 'MISSING_INPUTS' },
    ]);
    // Tick 3 : l'achat et la mouture se reposent (`stewards.refusalRestTicks`), la vente n'a pas de farine ; le
    // champ n'a rien à faire. Rien n'est tenté, rien n'est inscrit.
    expect(await runNpcHouseRules(db, tickOf(worldId, secours(0)))).toEqual({
      acted: 0,
      refused: 0,
      failed: 0,
    });
    state = await stateOf(worldId);
    expect(state.queues).toEqual(rested);
    expect(state.orders.map((order) => [order.name, order.side, order.remaining])).toEqual([
      ['Moissons', 'sell', 40],
    ]);
    // Un refus n'émet aucun événement d'intendant : une maison PNJ n'en a pas.
    const { rows } = await sql<{ n: string }>`select count(*) as n from game.domain_events
      where type = 'StewardActionFailed' and payload->>'houseId' in
        (select house_id::text from game.npc_houses where world_id = ${worldId})`.execute(owner);
    expect(rows[0]?.n).toBe('0');
  });

  it('le moteur les mène au pas des intendants, pour le dernier tick de chaque monde', async () => {
    const { worldId } = await founded(secours());
    await sql`insert into game.ticks (world_id, index, scheduled_at, seed, config_version_id, daily_close, season_switch)
      values (${worldId}, 3, now(), 'npc-rules-test-seed', ${versionId}, false, false)`.execute(
      owner,
    );
    const byId = async (id: string) => ({ id, config: configWith(secours()) });
    const results = await runAllStewards(db, { config: { byId } as never });
    expect(results.find((result) => result.worldId === worldId)).toEqual({
      worldId,
      run: { acted: 0, refused: 0, failed: 0 },
      npc: { acted: 2, refused: 0, failed: 0 },
    });
  });
});
