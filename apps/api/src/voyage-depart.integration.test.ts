import { randomUUID } from 'node:crypto';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql, type RawBuilder } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testVerifier } from './test-config';

// Départ d'un voyage, contre Supabase local. Le test fonde sa maison et achète son navire.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
/**
 * Transport gratuit (#668) : le départ ne coûte rien, donc n'a pas d'écriture ; les tarifs sont éprouvés par
 * `voyage-depart-rules.integration.test.ts`.
 */
const { ships } = TEST_CONFIG.config;
const free = (byClass: Record<string, number>) =>
  Object.fromEntries(Object.keys(byClass).map((id) => [id, 0]));
const FREE_TRANSPORT = {
  ...TEST_CONFIG,
  config: {
    ...TEST_CONFIG.config,
    ships: {
      ...ships,
      routes: ships.routes.map((route) => ({
        ...route,
        provisionsOboles: free(route.provisionsOboles),
      })),
      portDues: { ...ships.portDues, byClassOboles: free(ships.portDues.byClassOboles) },
    },
  },
};
const owner = createDb(DATABASE_URL);
const app = createApp({
  db,
  telemetry: createTelemetry(db),
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: async () => FREE_TRANSPORT,
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const [KALLISTE, ELAIA] = [
  '01900000-0000-7000-8000-000000000101',
  '01900000-0000-7000-8000-000000000103',
];

const send = async (user: string, command: string, body: unknown, key = randomUUID()) => {
  const res = await app.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    // Les formes exactes sont vérifiées champ par champ dans le test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: (await res.json()) as { data?: any; error?: { code: string } },
  };
};
const rows = async (query: RawBuilder<unknown>) => (await query.execute(owner)).rows;

describe('voyage.depart', () => {
  it('le navire prend la mer, sa cargaison sort du stock vers in_transit ; rejouer la clé ne repart pas', async () => {
    // Une maison de Kallistè, son caboteur à quai, 100 blés et 50 huiles posés dans son entrepôt.
    const user = randomUUID();
    await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
      owner,
    );
    const blazon = { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' };
    const name = `Armateurs ${[...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
    const houseId = (await send(user, 'house.create', { cityId: KALLISTE, name, blazon })).body.data
      .houseId;
    const coaster = TEST_CONFIG.config.ships.classes.find((row) => row.id === 'coaster');
    const bought = await send(user, 'ship.acquire', {
      classId: 'coaster',
      expectedCostOboles: coaster?.purchaseCostOboles,
    });
    const shipId = bought.body.data.shipId as string;
    for (const [good, quantity] of [
      ['wheat', 100],
      ['olive_oil', 50],
    ] as const) {
      await sql`insert into game.inventories (world_id, house_id, city_id, good_id)
        values ('01900000-0000-7000-8000-000000000001', ${houseId}, ${KALLISTE}, ${good})`.execute(
        owner,
      );
      await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
        select world_id, good_id, ${quantity}, 'production', id, 'test' from game.inventories
        where house_id = ${houseId} and good_id = ${good}`.execute(owner);
    }
    const stock = () =>
      rows(sql`select good_id, quantity from game.inventories
      where house_id = ${houseId} and city_id = ${KALLISTE} order by good_id`);
    const balance = () =>
      rows(sql`select balance from game.accounts where house_id = ${houseId} and kind = 'house'`);
    const before = await balance();

    const cargo = [
      { goodId: 'olive_oil', quantity: 50 },
      { goodId: 'wheat', quantity: 30 },
    ];
    const body = { shipId, fromCityId: KALLISTE, toCityId: ELAIA, cargo, expectedCostOboles: 0 };
    const key = randomUUID();
    const sailed = await send(user, 'voyage.depart', body, key);
    expect(sailed).toMatchObject({
      status: 200,
      body: { data: { shipId, fromCityId: KALLISTE, toCityId: ELAIA, cargo } },
    });
    const { portDuesOboles, costOboles, ...departure } = sailed.body.data;
    // Transport gratuit : rien à payer, donc aucune écriture ; Kallistè–Elaia, 4 heures pour un caboteur.
    expect([departure.provisionsOboles, portDuesOboles, costOboles]).toEqual([0, 0, 0]);
    expect(await balance()).toEqual(before);
    expect(Date.parse(departure.arrivesAt) - Date.parse(departure.departedAt)).toBe(4 * 3_600_000);
    expect(
      await rows(sql`select docked_city_id, laid_up_at from game.ships where id = ${shipId}`),
    ).toEqual([{ docked_city_id: null, laid_up_at: null }]);
    expect(await stock()).toEqual([
      { good_id: 'olive_oil', quantity: '0' },
      { good_id: 'wheat', quantity: '70' },
    ]);
    expect(
      await rows(sql`select good_id, quantity, to_system, kind from game.stock_ledger
        where voyage_id = ${departure.voyageId} order by good_id`),
    ).toEqual([
      { good_id: 'olive_oil', quantity: '50', to_system: 'in_transit', kind: 'voyage.departure' },
      { good_id: 'wheat', quantity: '30', to_system: 'in_transit', kind: 'voyage.departure' },
    ]);
    const events = sql`select payload from game.domain_events where type = 'VoyageDeparted' and payload->>'houseId' = ${houseId}`;
    expect(await rows(events)).toEqual([
      { payload: { ...departure, houseId, portDues: { oboles: 0, burned: 0, treasury: 0 } } },
    ]);
    // Rejeu de la même clé : même réponse, sans second voyage ; une clé neuve trouve le navire en mer.
    expect(await send(user, 'voyage.depart', body, key)).toEqual(sailed);
    expect(await send(user, 'voyage.depart', { ...body, cargo: [] })).toMatchObject({
      status: 409,
      body: { error: { code: 'SHIP_AT_SEA' } },
    });
    expect(await rows(events)).toHaveLength(1);
    expect(await rows(sql`select id from game.voyages where ship_id = ${shipId}`)).toHaveLength(1);
  });
});
