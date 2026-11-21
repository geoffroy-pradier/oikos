import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { expect } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testVerifier } from './test-config';

/**
 * Jeux d'essai des tests d'intégration des voyages, contre Supabase local : une maison de Kallistè, son
 * caboteur à quai et son entrepôt, posé par le propriétaire de la base.
 */
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const db = createDb(serviceRoleUrl(DATABASE_URL));
export const owner = createDb(DATABASE_URL);
export const WORLD = '01900000-0000-7000-8000-000000000001';
export const [KALLISTE, ELAIA, HALOS] = [
  '01900000-0000-7000-8000-000000000101',
  '01900000-0000-7000-8000-000000000103',
  '01900000-0000-7000-8000-000000000105',
] as const;

/** Tarifs du transport : `provisions` par voyage, droit de port `dues` à ×`elaiaBps` à Elaia, moitié détruite. */
export const pricedConfig =
  (provisions: number, dues = 0, elaiaBps = 10_000) =>
  (config: GameConfig): GameConfig => ({
    ...config,
    ships: {
      ...config.ships,
      routes: config.ships.routes.map((route) => ({
        ...route,
        provisionsOboles: { coaster: provisions, round_ship: provisions },
      })),
      portDues: {
        byClassOboles: { coaster: dues, round_ship: dues },
        burnShareBps: 5_000,
        cityCoefficientBps: { ...config.ships.portDues.cityCoefficientBps, elaia: elaiaBps },
      },
    },
  });

/**
 * L'API servie par la configuration de test au transport gratuit (provisions et droit de port nuls, comme avant #668 :
 * un test règle ses tarifs par `pricedConfig`), modifiée par `change`, sur la connexion `connection` (le service).
 */
export const appWithConfig = (
  change: (config: GameConfig) => GameConfig = (config) => config,
  connection = db,
) =>
  createApp({
    db: connection,
    telemetry: createTelemetry(connection),
    verifyToken: testVerifier,
    rateLimiter: unlimited,
    loadConfig: async () => ({
      ...TEST_CONFIG,
      config: change(pricedConfig(0)(TEST_CONFIG.config)),
    }),
  });
export type App = ReturnType<typeof appWithConfig>;
export const app = appWithConfig();

export interface Reply {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string; message: string } };
}
export const send = async (
  user: string,
  command: string,
  body: unknown,
  key: string = randomUUID(),
  via: App = app,
): Promise<Reply> => {
  const res = await via.request(`/api/commands/${command}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Reply['body'] };
};

/** Pose `quantity` unités produites dans l'entrepôt de la maison dans la cité. */
export async function give(
  houseId: string,
  goodId: string,
  quantity: number,
  cityId: string = KALLISTE,
) {
  await sql`insert into game.inventories (world_id, house_id, city_id, good_id)
    select world_id, ${houseId}, id, ${goodId} from game.cities where id = ${cityId}
    on conflict do nothing`.execute(owner);
  await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
    select world_id, good_id, ${quantity}, 'production', id, 'test' from game.inventories
    where house_id = ${houseId} and city_id = ${cityId} and good_id = ${goodId}`.execute(owner);
}

/** Une maison de la cité (Kallistè) fondée par la commande, son caboteur à quai, 100 blés et 50 huiles. */
export async function newShipowner(cityId: string = KALLISTE) {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  const name = `Armateurs ${[...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('')}`;
  const blazon = { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' };
  const founded = await send(user, 'house.create', { cityId, name, blazon });
  const houseId = founded.body.data.houseId as string;
  const price = TEST_CONFIG.config.ships.classes.find((row) => row.id === 'coaster');
  const bought = await send(user, 'ship.acquire', {
    classId: 'coaster',
    expectedCostOboles: price?.purchaseCostOboles,
  });
  await give(houseId, 'wheat', 100, cityId);
  await give(houseId, 'olive_oil', 50, cityId);
  return { user, houseId, shipId: bought.body.data.shipId as string };
}
export type Shipowner = Awaited<ReturnType<typeof newShipowner>>;

/** Départ de Kallistè vers Elaia avec 30 blés, au coût nul, sauf ce que `patch` change. */
export const depart = (
  player: Shipowner,
  patch: Record<string, unknown> = {},
  key?: string,
  via?: App,
) =>
  send(
    player.user,
    'voyage.depart',
    {
      shipId: player.shipId,
      fromCityId: KALLISTE,
      toCityId: ELAIA,
      cargo: [{ goodId: 'wheat', quantity: 30 }],
      expectedCostOboles: 0,
      ...patch,
    },
    key,
    via,
  );

/** Quantité d'un bien dans l'entrepôt de la maison dans la cité ; réservée par des ventes, à part. */
export const stockOf = async (houseId: string, goodId: string, cityId: string = KALLISTE) => {
  const { rows } = await sql<{ quantity: string; reserved: string }>`
    select quantity, reserved from game.inventories
    where house_id = ${houseId} and city_id = ${cityId} and good_id = ${goodId}`.execute(owner);
  return Number(rows[0]?.quantity ?? 0);
};
/** Solde d'une trésorerie de maison, d'un compte système (clé) ou du trésor d'une cité. */
export const balanceOf = async (
  account: { houseId: string } | { key: string } | { cityId: string },
) => {
  const { rows } = await sql<{
    balance: string;
  }>`select balance from game.accounts where world_id = ${WORLD}
    and ${'houseId' in account ? sql`house_id = ${account.houseId} and kind = 'house'` : 'key' in account ? sql`system_key = ${account.key}` : sql`city_id = ${account.cityId} and not npc_purse and bank_id is null`}`.execute(
    owner,
  );
  return Number(rows[0]?.balance);
};
export const shipOf = (shipId: string) =>
  owner
    .selectFrom('game.ships')
    .select(['docked_city_id', 'laid_up_at'])
    .where('id', '=', shipId)
    .executeTakeFirstOrThrow();
export const voyagesOf = (shipId: string) =>
  owner.selectFrom('game.voyages').selectAll().where('ship_id', '=', shipId).execute();
export const departuresOf = async (houseId: string) =>
  (
    await owner
      .selectFrom('game.domain_events')
      .select('payload')
      .where('type', '=', 'VoyageDeparted')
      .where(sql<boolean>`payload->>'houseId' = ${houseId}`)
      .execute()
  ).map((event) => event.payload);

/** Rien n'a bougé : ni voyage, ni stock, ni monnaie, ni événement ; le navire est à quai. */
export async function untouched(player: Shipowner, balance: number) {
  expect(await voyagesOf(player.shipId)).toEqual([]);
  expect(await shipOf(player.shipId)).toEqual({ docked_city_id: KALLISTE, laid_up_at: null });
  expect(await stockOf(player.houseId, 'wheat')).toBe(100);
  expect(await balanceOf({ houseId: player.houseId })).toBe(balance);
  expect(await departuresOf(player.houseId)).toEqual([]);
}
