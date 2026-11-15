import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import type { ConfigSource } from './registry';
import { createTelemetry } from './telemetry';
import { TEST_CONFIG, testConfig, testVerifier } from './test-config';

// Achat d'un navire, contre Supabase local. Chaque test fonde sa maison.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Le code testé agit sous le rôle de service, comme en production ; `owner` pose les jeux d'essai.
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const appWith = (loadConfig: ConfigSource) =>
  createApp({
    db,
    telemetry: createTelemetry(db),
    verifyToken: testVerifier,
    rateLimiter: unlimited,
    loadConfig,
  });
const app = appWith(testConfig);
/** Une application servie par une autre configuration que celle de test, du même monde. */
const appWithConfig = (change: (config: GameConfig) => GameConfig) =>
  appWith(async () => ({ ...TEST_CONFIG, config: change(TEST_CONFIG.config) }));
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const GRANT = TEST_CONFIG.config.starting.grantOboles;
const classOf = (id: string) => {
  const found = TEST_CONFIG.config.ships.classes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`ship class ${id} missing from the test configuration`);
  return found;
};
const COASTER = classOf('coaster').purchaseCostOboles;
const ROUND_SHIP = classOf('round_ship').purchaseCostOboles;
const FIELD = TEST_CONFIG.config.sites.acquisitionCostOboles.field;
const [KALLISTE, ELAIA] = [
  '01900000-0000-7000-8000-000000000101',
  '01900000-0000-7000-8000-000000000103',
];
const letters = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 10).join('');

interface Reply {
  status: number;
  // Les formes exactes sont vérifiées champ par champ dans les tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string; message: string } };
}
const send = async (
  user: string,
  command: string,
  body: unknown,
  key: string = randomUUID(),
  via = app,
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
async function newUser() {
  const user = randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
    owner,
  );
  return user;
}
/** Fonde une maison par la commande réelle : elle reçoit sa dotation et son premier site. */
async function newPlayer(cityId = KALLISTE) {
  const user = await newUser();
  const founded = await send(user, 'house.create', {
    cityId,
    name: `Armateurs ${letters()}`,
    blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
  });
  expect(founded.status).toBe(200);
  return { user, houseId: founded.body.data.houseId as string };
}
const buy = (user: string, classId: string, expectedCostOboles: number, key?: string, via = app) =>
  send(user, 'ship.acquire', { classId, expectedCostOboles }, key, via);
const shipsOf = async (houseId: string) =>
  db
    .selectFrom('game.ships')
    .select(['id', 'class_id', 'docked_city_id', 'laid_up_at'])
    .where('house_id', '=', houseId)
    .orderBy('id')
    .execute();
const balanceOf = async (houseId: string) =>
  Number(
    (
      await db
        .selectFrom('game.accounts')
        .select('balance')
        .where('house_id', '=', houseId)
        .where('kind', '=', 'house')
        .executeTakeFirstOrThrow()
    ).balance,
  );
const eventsOf = async (houseId: string) =>
  (
    await db
      .selectFrom('game.domain_events')
      .select('payload')
      .where(sql<boolean>`payload->>'houseId' = ${houseId}`)
      .where('type', '=', 'ShipAcquired')
      .orderBy('seq')
      .execute()
  ).map((event) => event.payload as Record<string, unknown>);
/** Rien n'a bougé : ni navire, ni monnaie, ni événement. */
async function untouched(houseId: string, balance = GRANT) {
  expect(await shipsOf(houseId)).toEqual([]);
  expect(await balanceOf(houseId)).toBe(balance);
  expect(await eventsOf(houseId)).toEqual([]);
}

describe('ship.acquire', () => {
  it('la maison paie le prix de la classe, détruit par le puits, et reçoit un navire armé à quai dans sa cité', async () => {
    const player = await newPlayer(ELAIA);
    const key = randomUUID();
    const bought = await buy(player.user, 'coaster', COASTER, key);
    expect(bought).toMatchObject({
      status: 200,
      body: { data: { classId: 'coaster', dockedCityId: ELAIA, costOboles: COASTER } },
    });
    const shipId = bought.body.data.shipId as string;
    expect(await shipsOf(player.houseId)).toEqual([
      { id: shipId, class_id: 'coaster', docked_city_id: ELAIA, laid_up_at: null },
    ]);
    expect(await balanceOf(player.houseId)).toBe(GRANT - COASTER);
    // L'écriture est équilibrée : la maison est débitée, le puits d'achat de navires crédité.
    const lines = await sql<{ key: string | null; amount: string }>`
      select a.system_key as key, l.amount from game.ledger_lines l
      join game.ledger_entries e on e.id = l.entry_id join game.accounts a on a.id = l.account_id
      where e.kind = 'ship.acquire' and e.meta->>'shipId' = ${shipId} order by l.amount`.execute(
      owner,
    );
    expect(lines.rows).toEqual([
      { key: null, amount: String(-COASTER) },
      { key: 'sink_ship_purchase', amount: String(COASTER) },
    ]);
    expect(await eventsOf(player.houseId)).toEqual([
      { shipId, houseId: player.houseId, cityId: ELAIA, classId: 'coaster', costOboles: COASTER },
    ]);
    // Rejeu de la même clé : même réponse, ni second navire ni second paiement.
    expect(await buy(player.user, 'coaster', COASTER, key)).toEqual(bought);
    // La même clé avec une autre entrée n'est pas un rejeu : refusée, sans effet.
    expect(await buy(player.user, 'round_ship', ROUND_SHIP, key)).toMatchObject({
      status: 409,
      body: { error: { code: 'IDEMPOTENCY_KEY_REUSED' } },
    });
    expect(await shipsOf(player.houseId)).toHaveLength(1);
    expect(await balanceOf(player.houseId)).toBe(GRANT - COASTER);
    expect(await eventsOf(player.houseId)).toHaveLength(1);
  });

  it('même clé envoyée plusieurs fois à la fois : un seul navire, un seul paiement, la même réponse', async () => {
    const player = await newPlayer();
    const key = randomUUID();
    const replies = await Promise.all(
      Array.from({ length: 4 }, () => buy(player.user, 'coaster', COASTER, key)),
    );
    expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200, 200]);
    for (const reply of replies) expect(reply).toEqual(replies[0]);
    expect(await shipsOf(player.houseId)).toHaveLength(1);
    expect(await balanceOf(player.houseId)).toBe(GRANT - COASTER);
    expect(await eventsOf(player.houseId)).toHaveLength(1);
  });

  it('prix changé : le prix vu est refusé sans effet, le nouveau se paie sous une clé neuve', async () => {
    const player = await newPlayer();
    for (const seen of [COASTER - 1, COASTER + 1])
      expect(await buy(player.user, 'coaster', seen)).toMatchObject({
        status: 409,
        body: { error: { code: 'PRICE_CHANGED' } },
      });
    await untouched(player.houseId);
    // Une version activée entre l'affichage et le clic rend le caboteur moins cher : le joueur, qui a vu
    // l'ancien prix, n'est pas servi au nouveau, plus bas comme plus haut.
    const cheaper = COASTER - 400;
    const after = appWithConfig((config) => ({
      ...config,
      ships: {
        classes: config.ships.classes.map((shipClass) =>
          shipClass.id === 'coaster' ? { ...shipClass, purchaseCostOboles: cheaper } : shipClass,
        ),
      },
    }));
    const key = randomUUID();
    const refused = await buy(player.user, 'coaster', COASTER, key, after);
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'PRICE_CHANGED' } } });
    expect(refused.body.error?.message).toContain(String(cheaper));
    // Le refus est lié à sa clé : la rejouer rend le même refus, même si le prix vu redevient juste.
    expect(await buy(player.user, 'coaster', COASTER, key)).toEqual(refused);
    await untouched(player.houseId);
    expect(await buy(player.user, 'coaster', cheaper, randomUUID(), after)).toMatchObject({
      status: 200,
      body: { data: { costOboles: cheaper } },
    });
    expect(await balanceOf(player.houseId)).toBe(GRANT - cheaper);
    // Sans prix vu, ou avec un prix mal formé : refus de validation, rien n'est payé.
    for (const body of [
      { classId: 'coaster' },
      { classId: 'coaster', expectedCostOboles: 0 },
      { classId: 'coaster', expectedCostOboles: 2400.5 },
    ])
      expect(await send(player.user, 'ship.acquire', body)).toMatchObject({
        status: 400,
        body: { error: { code: 'VALIDATION_FAILED' } },
      });
    expect(await shipsOf(player.houseId)).toHaveLength(1);
  });

  it('trésorerie insuffisante : refus, rien ne bouge ; trésorerie exacte : achat, solde nul', async () => {
    const player = await newPlayer();
    expect(ROUND_SHIP).toBeGreaterThan(GRANT);
    expect(await buy(player.user, 'round_ship', ROUND_SHIP)).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_FUNDS' } },
    });
    await untouched(player.houseId);
    // Un champ ramène la trésorerie juste au prix du caboteur : il se paie, le solde tombe à zéro.
    const field = Math.ceil((GRANT - COASTER) / FIELD);
    expect(field * FIELD).toBe(GRANT - COASTER);
    for (let n = 0; n < field; n += 1)
      expect((await send(player.user, 'site.acquire', { recipeId: 'grow_wheat' })).status).toBe(
        200,
      );
    expect(await balanceOf(player.houseId)).toBe(COASTER);
    expect((await buy(player.user, 'coaster', COASTER)).status).toBe(200);
    expect(await balanceOf(player.houseId)).toBe(0);
    expect(await buy(player.user, 'coaster', COASTER)).toMatchObject({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_FUNDS' } },
    });
    expect(await shipsOf(player.houseId)).toHaveLength(1);
    expect(await balanceOf(player.houseId)).toBe(0);
  });

  it('classe inconnue, version publiée avant le transport, compte sans maison : refus sans effet', async () => {
    const player = await newPlayer();
    expect(await buy(player.user, 'trireme', 1)).toMatchObject({
      status: 404,
      body: { error: { code: 'SHIP_CLASS_NOT_FOUND' } },
    });
    expect((await buy(player.user, 'Galère', 1)).status).toBe(400);
    const beforeTransport = appWithConfig((config) => ({ ...config, ships: { classes: [] } }));
    expect(await buy(player.user, 'coaster', COASTER, undefined, beforeTransport)).toMatchObject({
      status: 404,
      body: { error: { code: 'SHIP_CLASS_NOT_FOUND' } },
    });
    expect(await buy(await newUser(), 'coaster', COASTER)).toMatchObject({
      status: 404,
      body: { error: { code: 'HOUSE_NOT_FOUND' } },
    });
    await untouched(player.houseId);
  });
});
