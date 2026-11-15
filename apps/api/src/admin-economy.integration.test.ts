import { randomUUID } from 'node:crypto';
import { ADMIN_ROLES, adminEconomySchema, type AdminEconomy } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from './app';
import { unlimited } from './rate-limit';
import { createTelemetry } from './telemetry';
import { farCloseClock, TEST_CONFIG, testVerifier } from './test-config';

// Tableau de bord économique, contre Supabase local. Le test fonde son propre monde, pour des chiffres
// exacts ; les autres mondes de la base partagée servent au recoupement avec les soldes.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
// Clôture à plus d'une heure : le jour de jeu ne change pas pendant le test.
const config = { ...TEST_CONFIG.config, clock: farCloseClock(new Date()) };
const app = createApp({
  db,
  telemetry: createTelemetry(db),
  verifyToken: testVerifier,
  rateLimiter: unlimited,
  loadConfig: async () => ({ ...TEST_CONFIG, config }),
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

const [WORLD, CITY, EMPTY] = [randomUUID(), randomUUID(), randomUUID()];
const GRANT = config.starting.grantOboles;
const ORCHARD = config.sites.acquisitionCostOboles.orchard;
const HOUR = 3_600_000;
const today = gameDayAt(new Date(), config.clock);

let root: string | null = null;
async function newUser(role?: string) {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})`.execute(
    owner,
  );
  const grant = sql`insert into admin.roles (user_id, role, granted_by) values (${id}, ${role}, ${root})`;
  if (role) await grant.execute(owner);
  return id;
}
async function send(user: string, command: string, body: unknown) {
  const headers = { authorization: `Bearer ${user}`, 'Idempotency-Key': randomUUID() };
  const init = { method: 'POST', headers, body: JSON.stringify(body) };
  const res = await app.request(`/api/commands/${command}`, init);
  const reply = (await res.json()) as { ok: boolean; data: { houseId: string } };
  if (!reply.ok) throw new Error(`${command}: ${JSON.stringify(reply)}`);
  return reply.data;
}
const get = (user: string, query = '') =>
  app.request(`/api/admin/economy${query}`, { headers: { authorization: `Bearer aal2:${user}` } });
/**
 * Écriture posée par le propriétaire, datée de `ms` millisecondes après le début du jour de jeu
 * `today + day`. `lines` : montant par compte (clé d'un compte système, `treasury`, ou maison).
 */
async function entry(kind: string, day: number, ms: number, lines: Record<string, number>) {
  const at = new Date(dailyCloseAt(today + day, config.clock).getTime() + ms);
  await owner.transaction().execute(async (trx) => {
    const { rows } = await sql<{
      id: string;
    }>`insert into game.ledger_entries (world_id, kind, created_at)
      values (${WORLD}, ${kind}, ${at}) returning id`.execute(trx);
    for (const [ref, amount] of Object.entries(lines)) {
      await sql`insert into game.ledger_lines (entry_id, account_id, amount)
        select ${rows[0]?.id}, a.id, ${amount} from game.accounts a where a.world_id = ${WORLD}
          and ${ref} in (a.system_key, a.house_id::text, a.kind) and a.kind <> 'escrow'`.execute(
        trx,
      );
    }
  });
}

let observer = '';
const blazon = { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' };
beforeAll(async () => {
  const slug = randomUUID().slice(0, 8);
  await sql`insert into game.worlds (id, slug, name) values (${WORLD}, ${`eco-${slug}`}, 'Économie'),
    (${EMPTY}, ${`vide-${slug}`}, 'Vide')`.execute(owner);
  await sql`insert into game.cities (id, world_id, slug, name)
    values (${CITY}, ${WORLD}, 'agora', 'Agora')`.execute(owner);
  root = await newUser('super_admin');
  observer = await newUser('observer');
  const [alpha, beta] = [await newUser(), await newUser()];
  const { houseId: a } = await send(alpha, 'house.create', { cityId: CITY, name: 'Alpha', blazon });
  const { houseId: b } = await send(beta, 'house.create', { cityId: CITY, name: 'Beta', blazon });
  // Commandes réelles, aujourd'hui : un verger (puits d'acquisition), un achat en attente (séquestre).
  await send(alpha, 'site.acquire', { recipeId: 'grow_olives' });
  const order = { cityId: CITY, goodId: 'wheat', side: 'buy', price: 7, quantity: 10 };
  await send(beta, 'market.placeOrder', order);
  // Écritures datées : entretien, échange taxé (part détruite et part du trésor de la cité).
  await entry('upkeep.restart', -3, HOUR, { [a]: -30, sink_upkeep: 30 });
  await entry('market.trade', -3, HOUR, { [a]: -100, [b]: 95, sink_market_tax: 3, treasury: 2 });
  // Un jour de jeu commence à l'instant de sa clôture, bord compris.
  await entry('quest.reward', -2, -1, { faucet_rewards: -7, [a]: 7 });
  await entry('quest.reward', -2, 0, { faucet_rewards: -40, [a]: 40 });
  // Bord de la fenêtre de 30 jours : la milliseconde d'avant n'entre que dans le cumul.
  await entry('quest.reward', -29, -1, { faucet_rewards: -500, [b]: 500 });
  await entry('quest.reward', -29, 0, { faucet_rewards: -1, [b]: 1 });
  // Prêt remboursé le même jour : net nul, aucun mouvement ce jour-là, cumul nul.
  await entry('temple.loan', -5, HOUR, { faucet_temple_loans: -200, [a]: 200 });
  await entry('temple.repay', -5, 2 * HOUR, { faucet_temple_loans: 200, [a]: -200 });
});

async function read(id: string, query = '') {
  const res = await get(observer, query);
  expect(res.status).toBe(200);
  const data = adminEconomySchema.parse(((await res.json()) as { data: unknown }).data);
  const world = data.worlds.find((candidate) => candidate.worldId === id);
  if (!world) throw new Error(`world ${id} missing`);
  return { data, world };
}
/** Comptes système qui ont bougé : cumul, puis [jour de jeu compté depuis aujourd'hui, montant]. */
const moved = (world: AdminEconomy['worlds'][number]) =>
  Object.fromEntries(
    world.systemAccounts
      .filter((row) => row.total !== 0 || row.days.length > 0)
      .map((row) => [row.key, [row.total, ...row.days.map((d) => [d.gameDay - today, d.amount])]]),
  );

it('n’est ouvert qu’aux rôles des tableaux de bord', async () => {
  const statuses: Record<string, number> = { none: (await get(await newUser())).status };
  for (const role of ADMIN_ROLES) statuses[role] = (await get(await newUser(role))).status;
  expect(Object.keys(statuses).filter((role) => statuses[role] !== 403)).toEqual([
    'super_admin',
    'game_designer',
    'observer',
  ]);
  expect([statuses['super_admin'], statuses['game_designer'], statuses['observer']]).toEqual([
    200, 200, 200,
  ]);
});

it('masse monétaire par nature de compte, robinets et puits en cumul et par jour de jeu', async () => {
  const { data, world } = await read(WORLD);
  expect(data.windowDays).toBe(30);
  expect(world.moneySupply).toEqual({
    total: 2 * GRANT - ORCHARD + 515,
    houses: 2 * GRANT - ORCHARD + 443,
    escrow: 70,
    cityTreasuries: 2,
    other: 0,
  });
  expect(moved(world)).toEqual({
    faucet_starting_grant: [2 * GRANT, [0, 2 * GRANT]],
    faucet_rewards: [548, [-29, 1], [-3, 7], [-2, 40]],
    sink_site_acquisition: [ORCHARD, [0, ORCHARD]],
    sink_upkeep: [30, [-3, 30]],
    sink_market_tax: [3, [-3, 3]],
  });
  for (const row of world.systemAccounts) expect(row.key.startsWith(`${row.kind}_`)).toBe(true);
  // Monde sans maison ni écriture : tout est nul, rien n'est absent.
  const { world: empty } = await read(EMPTY);
  expect(new Set(Object.values(empty.moneySupply))).toEqual(new Set([0]));
  expect(empty.systemAccounts.map((row) => row.key)).toEqual(
    world.systemAccounts.map((r) => r.key),
  );
  expect(moved(empty)).toEqual({});
});

it('`days` règle le nombre de jours détaillés, sans toucher aux cumuls', async () => {
  const two = await read(WORLD, '?days=2');
  expect(two.data.windowDays).toBe(2);
  expect(moved(two.world)['faucet_rewards']).toEqual([548]);
  expect(moved(two.world)['sink_site_acquisition']).toEqual([ORCHARD, [0, ORCHARD]]);
  // Au-delà du maximum, la fenêtre est bornée et la réponse le dit.
  const wide = await read(WORLD, '?days=999');
  expect(wide.data.windowDays).toBe(90);
  expect(moved(wide.world)['faucet_rewards']).toEqual([
    548,
    [-30, 500],
    [-29, 1],
    [-3, 7],
    [-2, 40],
  ]);
  for (const bad of ['0', '-1', '1.5', '1000', 'abc', '']) {
    const res = await get(observer, `?days=${bad}`);
    expect([bad, res.status]).toEqual([bad, 400]);
  }
});

it('dans chaque monde, la masse affichée est la somme des soldes et le net des robinets et des puits', async () => {
  const { data } = await read(WORLD);
  // Recoupement indépendant de la route : soldes des comptes, et cumul des lignes du grand livre.
  const { rows } = await sql<{ world_id: string; held: string; lines: string }>`
    select a.world_id, sum(a.balance)::text as held,
           coalesce((select sum(l.amount) from game.ledger_lines l join game.accounts x on x.id = l.account_id
                     where x.world_id = a.world_id and x.kind <> 'system'), 0)::text as lines
    from game.accounts a where a.kind <> 'system' group by a.world_id`.execute(owner);
  expect(data.worlds.length).toBeGreaterThanOrEqual(3);
  for (const world of data.worlds) {
    const held = rows.find((row) => row.world_id === world.worldId);
    const { total, houses, escrow, cityTreasuries, other } = world.moneySupply;
    expect([Number(held?.held ?? 0), Number(held?.lines ?? 0)]).toEqual([total, total]);
    expect(houses + escrow + cityTreasuries + other).toBe(total);
    const net = (kind: string) =>
      world.systemAccounts.reduce((sum, row) => sum + (row.kind === kind ? row.total : 0), 0);
    expect(net('faucet') - net('sink')).toBe(total);
  }
});

it('lue pendant que des maisons se fondent, garde cumul et jours d’un même instantané', async () => {
  const founding = [...'abcdefgh'].map(async (letter) =>
    send(await newUser(), 'house.create', { cityId: CITY, name: `Gamma ${letter}`, blazon }),
  );
  const reads = await Promise.all(Array.from({ length: 16 }, () => read(WORLD)));
  await Promise.all(founding);
  for (const { world } of [...reads, await read(WORLD)]) {
    const grant = world.systemAccounts.find((row) => row.key === 'faucet_starting_grant');
    expect(grant?.days.reduce((sum, day) => sum + day.amount, 0)).toBe(grant?.total);
  }
  expect((await read(WORLD)).world.moneySupply.total).toBe(10 * GRANT - ORCHARD + 515);
});
