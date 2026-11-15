import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@oikos/config';
import { siteUpkeep } from '@oikos/engine';
import { sql } from 'kysely';
import { TEST_CONFIG } from './test-config';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appWithConfig,
  balanceOf,
  db,
  depart,
  ELAIA,
  HALOS,
  KALLISTE,
  newShipowner,
  owner,
  pricedConfig,
  send,
  shipOf,
  stockOf,
  untouched,
  voyagesOf,
  type App,
  type Shipowner,
} from './voyage.integration-fixtures';

// Règles du départ d'un voyage : coût, refus, concurrence, stock réservé. Contre Supabase local.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Un second caboteur à quai à Kallistè, posé par le propriétaire de la base. */
const secondShip = async (player: Shipowner) =>
  (
    await sql<{ id: string }>`insert into game.ships (world_id, house_id, class_id, docked_city_id)
      values ('01900000-0000-7000-8000-000000000001', ${player.houseId}, 'coaster', ${KALLISTE})
      returning id`.execute(owner)
  ).rows[0]?.id ?? '';
const sell = (player: Shipowner, quantity: number) =>
  send(player.user, 'market.placeOrder', {
    cityId: KALLISTE,
    goodId: 'wheat',
    side: 'sell',
    price: 1_000_000,
    quantity,
  });

describe('voyage.depart : coût, refus et concurrence', () => {
  it('provisions et droit de port payés dans une écriture voyage.departure, au coût vu seulement', async () => {
    const player = await newShipowner();
    const balance = await balanceOf({ houseId: player.houseId });
    const before = {
      provisions: await balanceOf({ key: 'sink_voyage_provisions' }),
      dues: await balanceOf({ key: 'sink_port_dues' }),
      elaia: await balanceOf({ cityId: ELAIA }),
    };
    // 30 de provisions ; ⌈41 × 1,25⌉ = 52 de droit de port à Elaia, dont 26 détruites et 26 au trésor.
    const priced = appWithConfig(pricedConfig(30, 41, 12_500));
    for (const seen of [0, 81, 83])
      expect(await depart(player, { expectedCostOboles: seen }, undefined, priced)).toMatchObject({
        status: 409,
        body: { error: { code: 'PRICE_CHANGED' } },
      });
    await untouched(player, balance);
    const sailed = await depart(player, { expectedCostOboles: 82 }, undefined, priced);
    expect(sailed.body.data).toMatchObject({
      provisionsOboles: 30,
      portDuesOboles: 52,
      costOboles: 82,
    });
    expect(await balanceOf({ houseId: player.houseId })).toBe(balance - 82);
    expect(await balanceOf({ key: 'sink_voyage_provisions' })).toBe(before.provisions + 30);
    expect(await balanceOf({ key: 'sink_port_dues' })).toBe(before.dues + 26);
    expect(await balanceOf({ cityId: ELAIA })).toBe(before.elaia + 26);
    const lines = await sql<{ key: string | null; city: string | null; amount: string }>`
      select a.system_key as key, a.city_id as city, l.amount from game.ledger_lines l
      join game.ledger_entries e on e.id = l.entry_id join game.accounts a on a.id = l.account_id
      where e.kind = 'voyage.departure' and e.meta->>'voyageId' = ${sailed.body.data.voyageId}
      order by l.amount, a.system_key`.execute(owner);
    expect(lines.rows).toEqual([
      { key: null, city: null, amount: '-52' },
      { key: null, city: null, amount: '-30' },
      { key: 'sink_port_dues', city: null, amount: '26' },
      { key: null, city: ELAIA, amount: '26' },
      { key: 'sink_voyage_provisions', city: null, amount: '30' },
    ]);
  });

  it('refus sans effet : navire, cité, bien, route, classe, capacité, stock libre, trésorerie, désarmement', async () => {
    const [player, other] = [await newShipowner(), await newShipowner()];
    const balance = await balanceOf({ houseId: player.houseId });
    const withShips = (change: (ships: GameConfig['ships']) => Partial<GameConfig['ships']>) =>
      appWithConfig((config) => ({
        ...config,
        ships: { ...config.ships, ...change(config.ships) },
      }));
    const refusals: [string, Record<string, unknown>, App?][] = [
      ['SHIP_NOT_FOUND', { shipId: other.shipId }],
      ['SHIP_NOT_FOUND', { shipId: randomUUID() }],
      ['CITY_NOT_FOUND', { toCityId: randomUUID() }],
      ['GOOD_NOT_FOUND', { cargo: [{ goodId: 'ambrosia', quantity: 1 }] }],
      ['SHIP_NOT_IN_CITY', { fromCityId: ELAIA, toCityId: KALLISTE }],
      ['NO_ROUTE', { toCityId: KALLISTE }],
      ['NO_ROUTE', {}, withShips(() => ({ routes: [] }))],
      ['SHIP_CLASS_RETIRED', {}, withShips((ships) => ({ classes: ships.classes.slice(1) }))],
      ['CARGO_OVER_CAPACITY', { cargo: [{ goodId: 'wheat', quantity: 301 }] }],
      ['INSUFFICIENT_STOCK', { cargo: [{ goodId: 'wheat', quantity: 101 }] }],
      ['INSUFFICIENT_STOCK', { cargo: [{ goodId: 'bread', quantity: 1 }] }],
      [
        'INSUFFICIENT_FUNDS',
        { expectedCostOboles: balance + 1 },
        appWithConfig(pricedConfig(balance + 1)),
      ],
    ];
    for (const [code, patch, via] of refusals)
      expect([code, await depart(player, patch, undefined, via)]).toMatchObject([
        code,
        { status: code.endsWith('_NOT_FOUND') ? 404 : 409, body: { error: { code } } },
      ]);
    await untouched(player, balance);
    // Un navire désarmé ne part pas, jusqu'à ce qu'une clôture le réarme.
    await sql`update game.ships set laid_up_at = now() where id = ${player.shipId}`.execute(owner);
    expect(await depart(player)).toMatchObject({ body: { error: { code: 'SHIP_LAID_UP' } } });
    await sql`update game.ships set laid_up_at = null where id = ${player.shipId}`.execute(owner);
    // Halos, plus loin : la route y mène aussi.
    expect((await depart(player, { toCityId: HALOS })).status).toBe(200);
  });

  it('départs simultanés du même navire : un seul part, la cargaison ne sort qu’une fois', async () => {
    const player = await newShipowner();
    const replies = await Promise.all(
      [ELAIA, HALOS, ELAIA, HALOS].map((toCityId) => depart(player, { toCityId })),
    );
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409, 409, 409]);
    for (const reply of replies.filter((candidate) => candidate.status === 409))
      expect(reply.body.error?.code).toBe('SHIP_AT_SEA');
    expect(await voyagesOf(player.shipId)).toHaveLength(1);
    expect(await stockOf(player.houseId, 'wheat')).toBe(70);
  });

  it('deux navires dont la trésorerie ne paie qu’un départ : un seul part, solde jamais négatif', async () => {
    const player = await newShipowner();
    const [balance, other] = [
      await balanceOf({ houseId: player.houseId }),
      await secondShip(player),
    ];
    const cost = Math.floor(balance / 2) + 1;
    const priced = appWithConfig(pricedConfig(cost));
    const replies = await Promise.all(
      [player.shipId, other].map((shipId) =>
        depart({ ...player, shipId }, { expectedCostOboles: cost }, undefined, priced),
      ),
    );
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect(replies.find((reply) => reply.status === 409)?.body.error?.code).toBe(
      'INSUFFICIENT_FUNDS',
    );
    expect(await balanceOf({ houseId: player.houseId })).toBe(balance - cost);
  });

  it('le stock réservé par une vente ne part pas, et le stock en mer ne se vend pas', async () => {
    const player = await newShipowner();
    expect((await sell(player, 80)).status).toBe(200);
    // 100 blés, dont 80 réservés : 20 de libres.
    expect(await depart(player, { cargo: [{ goodId: 'wheat', quantity: 21 }] })).toMatchObject({
      body: { error: { code: 'INSUFFICIENT_STOCK' } },
    });
    expect((await depart(player, { cargo: [{ goodId: 'wheat', quantity: 20 }] })).status).toBe(200);
    const { rows } = await sql<{ quantity: string; reserved: string }>`
      select quantity, reserved from game.inventories
      where house_id = ${player.houseId} and city_id = ${KALLISTE} and good_id = 'wheat'`.execute(
      owner,
    );
    expect(rows).toEqual([{ quantity: '80', reserved: '80' }]);
    // Les 20 blés en mer ne sont dans aucun stock : rien de plus ne se met en vente.
    expect(await sell(player, 1)).toMatchObject({
      body: { error: { code: 'INSUFFICIENT_STOCK' } },
    });
  });

  it('départ et clôture simultanés : aucun interblocage ; un navire désarmé ne part pas, un navire parti l’est en mer', async () => {
    // Entretien des navires impayable : la clôture désarme le caboteur, avant ou après son départ.
    const classes = TEST_CONFIG.config.ships.classes.map((row) => ({
      ...row,
      dailyUpkeepOboles: 1e9,
    }));
    const config = { ...TEST_CONFIG.config, ships: { ...TEST_CONFIG.config.ships, classes } };
    for (let round = 0; round < 4; round += 1) {
      // Un monde à part : l'étape d'entretien prélève toutes les maisons du monde où elle tourne.
      const [worldId, kalliste, elaia] = [randomUUID(), randomUUID(), randomUUID()];
      await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`v-${worldId.slice(0, 12)}`}, 'Test'))
        insert into game.cities (id, world_id, slug, name)
        values (${kalliste}, ${worldId}, 'kalliste', 'Kallistè'), (${elaia}, ${worldId}, 'elaia', 'Elaia')`.execute(
        owner,
      );
      const player = await newShipowner(kalliste);
      const closeAt = new Date();
      const [sailed] = await Promise.all([
        depart(player, { fromCityId: kalliste, toCityId: elaia }),
        db
          .transaction()
          .execute((trx) => siteUpkeep.run({ worldId, gameDay: 20_771, closeAt, config, trx })),
      ]);
      const ship = await shipOf(player.shipId);
      expect(ship.laid_up_at).not.toBeNull();
      if (sailed.status === 200) expect(ship.docked_city_id).toBeNull();
      else
        expect([sailed.body.error?.code, ship.docked_city_id]).toEqual(['SHIP_LAID_UP', kalliste]);
    }
  });
});
