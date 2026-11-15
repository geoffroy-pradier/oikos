import { randomUUID } from 'node:crypto';
import { ADMIN_ROLES, adminEconomySchema, type AdminEconomy } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { historyStarts, readEconomy } from './admin-economy';
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
const basket = [
  { goodId: 'wheat', quantity: 3 },
  { goodId: 'bread', quantity: 1 },
];
const priceIndex = { windowDays: 30, inflationTargetBps: { min: 0, max: 300 }, basket };
const config = { ...TEST_CONFIG.config, clock: farCloseClock(new Date()), priceIndex };
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

/**
 * Chandelier du monde de test (ou du monde et de la cité `place`), commencé il y a `age` jours (au début
 * de l'heure ; négatif : dans le futur) ou à l'instant donné : `turnover` oboles pour `volume` unités.
 */
const candle = (
  goodId: string,
  age: number | Date,
  turnover: number,
  volume: number,
  seconds = 3600,
  [world, city]: [string, string] = [WORLD, CITY],
) =>
  sql`insert into game.price_candles
        (world_id, city_id, good_id, period_seconds, period_start, open, high, low, close, volume, turnover)
      select ${world}, ${city}, ${goodId}, ${seconds},
             ${typeof age === 'number' ? sql`date_trunc('hour', now() - make_interval(days => ${age}))` : sql`${age}::timestamptz`},
             p.low, p.high, p.low, p.high, ${volume}, ${turnover}
      from (select floor(${turnover}::numeric / ${volume}) as low, ceil(${turnover}::numeric / ${volume}) as high) p`.execute(
    owner,
  );

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
  // Écriture datée du lendemain (horloge décalée) : dans le cumul, jamais dans le jour en cours.
  await entry('quest.reward', 1, 0, { faucet_rewards: -9, [a]: 9 });
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
/** Fonde un monde et sa cité, propres au test qui l'appelle ; rend [monde, cité]. */
async function newWorld(): Promise<[string, string]> {
  const [world, city] = [randomUUID(), randomUUID()];
  const slug = `bord-${randomUUID().slice(0, 8)}`;
  await sql`insert into game.worlds (id, slug, name) values (${world}, ${slug}, 'Bords')`.execute(
    owner,
  );
  await sql`insert into game.cities (id, world_id, slug, name)
    values (${city}, ${world}, 'agora', 'Agora')`.execute(owner);
  return [world, city];
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
    total: 2 * GRANT - ORCHARD + 524,
    houses: 2 * GRANT - ORCHARD + 452,
    escrow: 70,
    cityTreasuries: 2,
    other: 0,
  });
  expect(moved(world)).toEqual({
    faucet_starting_grant: [2 * GRANT, [0, 2 * GRANT]],
    faucet_rewards: [557, [-29, 1], [-3, 7], [-2, 40]],
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
  expect(moved(two.world)['faucet_rewards']).toEqual([557]);
  expect(moved(two.world)['sink_site_acquisition']).toEqual([ORCHARD, [0, ORCHARD]]);
  // Au-delà du maximum, la fenêtre est bornée et la réponse le dit.
  const wide = await read(WORLD, '?days=999');
  expect(wide.data.windowDays).toBe(90);
  expect(moved(wide.world)['faucet_rewards']).toEqual([
    557,
    [-30, 500],
    [-29, 1],
    [-3, 7],
    [-2, 40],
  ]);
  expect((await read(WORLD, '?days=1000')).data.windowDays).toBe(90);
  for (const bad of ['0', '-1', '1.5', '090', 'abc', '']) {
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

it('indice du panier et inflation d’une fenêtre à la précédente, situés par rapport à la cible', async () => {
  // Fenêtre courante : blé (20 + 19) ÷ 6 = 6,5, pain 32 ÷ 2 = 16. Précédente : blé 6,5, pain 16,5.
  await candle('wheat', 10, 20, 3);
  await candle('wheat', 2, 19, 3);
  await candle('bread', 5, 32, 2);
  await candle('wheat', 40, 13, 2);
  await candle('bread', 40, 33, 2);
  // Ignorés : trop ancien, autre série de chandeliers, bien hors panier.
  await candle('wheat', 61, 900, 1);
  await candle('bread', 3, 900, 1, 900);
  await candle('fish', 3, 900, 1);
  // Ignoré aussi : un chandelier daté dans le futur (horloge décalée), au-delà de l'horloge de la base.
  await candle('wheat', -1, 900, 1);
  // Panier de référence : 3 × 6 + 15 = 33. Courant : 3 × 6,5 + 16 = 35,5. Précédent : 3 × 6,5 + 16,5 = 36.
  // Inflation exacte : 35,5 ÷ 36 − 1 = −138,9 points, soit −139 ; le rapport des indices arrondis
  // (10 758 ÷ 10 909) donnerait −138.
  const index = { currentBps: 10_758, previousBps: 10_909, inflationBps: -139 };
  const known = {
    unpricedGoods: [],
    unpricedByWindow: { current: [], previous: [] },
    partialWindow: null,
  };
  const { data, world } = await read(WORLD);
  expect([data.priceWindowDays, data.inflationTargetBps, data.basketEmpty]).toEqual([
    30,
    { min: 0, max: 300 },
    false,
  ]);
  expect(world.priceIndex).toEqual({ ...index, status: 'below', ...known });
  const unknown = { currentBps: null, previousBps: null, inflationBps: null, status: 'unknown' };
  const none = { current: [], previous: [] };
  const missing = (current: string[], previous: string[]) => ({
    unpricedGoods: [...new Set([...current, ...previous])],
    unpricedByWindow: { current, previous },
  });
  expect((await read(EMPTY)).world.priceIndex).toEqual({
    ...unknown,
    ...missing(['wheat', 'bread'], ['wheat', 'bread']),
    partialWindow: null,
  });
  const withIndex = async (patch: Partial<typeof priceIndex>) => {
    const patched = { ...config, priceIndex: { ...priceIndex, ...patch } };
    return (await readEconomy(db, patched, 1)).worlds.find((w) => w.worldId === WORLD)?.priceIndex;
  };
  // Cible bornes comprises.
  const status = async (min: number, max: number) =>
    (await withIndex({ inflationTargetBps: { min, max } }))?.status;
  expect([await status(-139, -139), await status(-300, -140), await status(-138, 0)]).toEqual([
    'in_target',
    'above',
    'below',
  ]);
  const empty = { ...unknown, unpricedByWindow: none, partialWindow: null };
  expect(await withIndex({ basket: [] })).toEqual({ ...empty, unpricedGoods: [] });
  // Panier vide : la réponse le dit, l'écran n'a pas à le déduire d'une liste de biens vide.
  const noBasket = { ...config, priceIndex: { ...priceIndex, basket: [] } };
  expect((await readEconomy(db, noBasket, 1)).basketEmpty).toBe(true);
  // Un bien du panier sans échange : inconnu, jamais un prix inventé.
  const salted = [...basket, { goodId: 'salt', quantity: 1 }];
  expect(await withIndex({ basket: salted })).toEqual({
    ...unknown,
    ...missing(['salt'], ['salt']),
    partialWindow: null,
  });
  // Fenêtres comptées depuis l'horloge de la base. De 45 jours : la courante prend aussi les chandeliers
  // de 40 jours (blé 52 ÷ 8, pain 65 ÷ 4, panier à 35,75) ; la précédente n'a que du blé, à 61 jours,
  // et commence avant le premier chandelier du monde : elle est partielle.
  // De 19 jours : les chandeliers de 40 jours sont trop anciens pour la précédente, qui est vide.
  const [wide, narrow] = [await withIndex({ windowDays: 45 }), await withIndex({ windowDays: 19 })];
  expect(wide).toEqual({
    ...unknown,
    currentBps: 10_833,
    ...missing([], ['bread']),
    partialWindow: 'previous',
  });
  expect(narrow).toEqual({
    ...unknown,
    currentBps: 10_758,
    ...missing([], ['wheat', 'bread']),
    partialWindow: null,
  });
  // L'historique du monde commence il y a 61 jours (premier chandelier). Fenêtres de 31 jours : la
  // précédente commence avant lui, n'est mesurée que sur ses 30 derniers jours, et le dit ; l'inflation
  // est calculée telle quelle (blé (13 + 900) ÷ 3, pain 16,5 : panier à 929,5 ; 35,5 ÷ 929,5 − 1).
  expect(await withIndex({ windowDays: 31 })).toEqual({
    currentBps: 10_758,
    previousBps: 281_667,
    inflationBps: -9_618,
    status: 'below',
    ...known,
    partialWindow: 'previous',
  });
  // Fenêtres de 65 jours : la courante commence avant l'historique, la précédente est vide.
  expect(await withIndex({ windowDays: 65 })).toMatchObject({
    inflationBps: null,
    ...missing([], ['wheat', 'bread']),
    partialWindow: 'current',
  });
});

it('l’indice d’un monde compte les échanges de ses quatre cités (#250)', async () => {
  const world = randomUUID();
  const cities = ['kalliste', 'elaia', 'ampelos', 'halos'].map((slug) => [slug, randomUUID()]);
  await sql`insert into game.worlds (id, slug, name) values (${world}, ${`quatre-${world.slice(0, 8)}`}, 'Quatre')`.execute(
    owner,
  );
  for (const [slug, city] of cities)
    await sql`insert into game.cities (id, world_id, slug, name) values (${city}, ${world}, ${slug}, ${slug})`.execute(
      owner,
    );
  const [kalliste, elaia, ampelos, halos] = cities.map(([, city]): [string, string] => [
    world,
    city ?? '',
  ]);
  // Chaque chandelier dans une autre cité : en oublier une laisserait un bien sans prix ou en changerait un.
  // Fenêtre courante : blé (18 + 24) ÷ 6 = 7, pain (30 + 34) ÷ 4 = 16. Précédente : blé 6, pain 15.
  await candle('wheat', 2, 18, 3, 3600, kalliste);
  await candle('wheat', 3, 24, 3, 3600, elaia);
  await candle('bread', 4, 30, 2, 3600, ampelos);
  await candle('bread', 5, 34, 2, 3600, halos);
  await candle('wheat', 40, 36, 6, 3600, halos);
  await candle('bread', 40, 30, 2, 3600, kalliste);
  // Hors panier et hors fenêtres : l'historique commence avant elles, aucune n'est partielle.
  await candle('fish', 61, 12, 1, 3600, ampelos);
  // Référence 3 × 6 + 15 = 33 ; courant 3 × 7 + 16 = 37 ; précédent 3 × 6 + 15 = 33.
  expect((await read(world)).world.priceIndex).toEqual({
    currentBps: 11_212,
    previousBps: 10_000,
    inflationBps: 1_212,
    status: 'above',
    unpricedGoods: [],
    unpricedByWindow: { current: [], previous: [] },
    partialWindow: null,
  });
});

it('bords des fenêtres : début compris, fin exclue, à l’instant près', async () => {
  // Monde propre au test : ni ses chandeliers ni son historique ne dépendent des autres tests.
  const place = await newWorld();
  // Horloge de la base épinglée (première requête de la route) près d'un début d'heure `hour`, pour
  // poser des chandeliers exactement sur les bords : il y a 60 jours, il y a 30 jours, et à `hour`.
  const hour = new Date(Math.floor(Date.now() / HOUR) * HOUR);
  const ago = (days: number, from = hour) => new Date(from.getTime() - days * 24 * HOUR);
  await candle('salt', ago(60), 14, 2, 3600, place);
  await candle('salt', ago(30), 16, 2, 3600, place);
  await candle('salt', hour, 900, 1, 3600, place);
  const salt = {
    ...config,
    priceIndex: { ...priceIndex, basket: [{ goodId: 'salt', quantity: 1 }] },
  };
  const at = async (now: Date) => {
    let queries = 0;
    const pinned = db.withPlugin({
      transformQuery: ({ node }) => node,
      transformResult: async ({ result }) =>
        ++queries === 1 ? { ...result, rows: [{ now }] } : result,
    });
    const seen = (await readEconomy(pinned, salt, 1)).worlds.find((w) => w.worldId === place[0]);
    return seen?.priceIndex;
  };
  // Précédente [−60 j, −30 j) : sel à 7 ; courante [−30 j, maintenant) : sel à 8 ; le chandelier qui
  // commence à l'instant même n'est dans aucune. Référence du sel : 7. L'historique commence au début
  // exact de la précédente : elle est entière.
  const known = { unpricedGoods: [], unpricedByWindow: { current: [], previous: [] } };
  const both = { currentBps: 11_429, previousBps: 10_000, inflationBps: 1_429, ...known };
  expect(await at(hour)).toEqual({ ...both, status: 'above', partialWindow: null });
  // Une milliseconde plus tôt, l'historique commence strictement à l'intérieur de la précédente.
  const early = new Date(hour.getTime() - 1);
  expect(await at(early)).toEqual({ ...both, status: 'above', partialWindow: 'previous' });
  // Trente jours plus tôt : l'historique commence au début exact de la courante (entière, sel à 7, le
  // chandelier de −30 j commence à l'instant même), et la précédente est vide.
  const unknown = { inflationBps: null, status: 'unknown', unpricedGoods: ['salt'] };
  const alone = { ...unknown, unpricedByWindow: { current: [], previous: ['salt'] } };
  const month = ago(30);
  expect(await at(month)).toEqual({
    currentBps: 10_000,
    previousBps: null,
    ...alone,
    partialWindow: null,
  });
  // Une milliseconde plus tôt encore, l'historique commence à l'intérieur de la courante.
  expect(await at(new Date(month.getTime() - 1))).toMatchObject({ partialWindow: 'current' });
});

it('l’historique d’un monde commence au premier chandelier passé, jamais à un chandelier futur', async () => {
  const [world, city] = await newWorld();
  const hour = new Date(Math.floor(Date.now() / HOUR) * HOUR);
  const later = new Date(hour.getTime() + 2 * HOUR);
  // Seul chandelier du monde, daté au-delà de l'horloge (horloge décalée) : pas d'historique.
  await candle('salt', later, 7, 1, 3600, [world, city]);
  expect((await historyStarts(db, 3600, hour)).has(world)).toBe(false);
  // Un chandelier qui commence à l'instant même n'est pas encore passé ; une heure après, il l'est.
  await candle('salt', hour, 7, 1, 3600, [world, city]);
  expect((await historyStarts(db, 3600, hour)).has(world)).toBe(false);
  const next = new Date(hour.getTime() + HOUR);
  expect((await historyStarts(db, 3600, next)).get(world)).toEqual(hour);
  // Le plus ancien l'emporte, quel que soit l'ordre d'insertion ; une autre série ne compte pas.
  const before = new Date(hour.getTime() - 5 * HOUR);
  await candle('wheat', before, 7, 1, 3600, [world, city]);
  const day = new Date(hour.getTime() - 24 * HOUR);
  await candle('wheat', day, 7, 1, 900, [world, city]);
  expect((await historyStarts(db, 3600, next)).get(world)).toEqual(before);
  expect((await historyStarts(db, 900, next)).get(world)).toEqual(day);
  // Recoupement avec l'agrégat sur toute la série, pour tous les mondes de la base, dans un même instantané.
  const [rows, starts] = await owner
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      const all = await sql<{ world_id: string; first: Date }>`
        select world_id, min(period_start) as first from game.price_candles
        where period_seconds = 3600 and period_start < ${next} group by world_id`.execute(trx);
      return [all.rows, await historyStarts(trx, 3600, next)] as const;
    });
  expect(rows.length).toBeGreaterThan(0);
  expect(new Map(rows.map((row) => [row.world_id, row.first]))).toEqual(starts);
});

it('lue pendant qu’une maison se fonde, garde cumul et jours d’un même instantané', async () => {
  // Course rendue certaine : une fondation est validée entre la lecture des soldes (deuxième requête de
  // la route, après l'horloge) et celle des mouvements par jour.
  let queries = 0;
  const racing = db.withPlugin({
    transformQuery: ({ node }) => node,
    transformResult: async ({ result }) => {
      const founded = { cityId: CITY, name: 'Gamma', blazon };
      if (++queries === 2) await send(await newUser(), 'house.create', founded);
      return result;
    },
  });
  const seen = (await readEconomy(racing, config, 30)).worlds.find((w) => w.worldId === WORLD);
  expect(queries).toBe(5);
  expect(seen && moved(seen)['faucet_starting_grant']).toEqual([2 * GRANT, [0, 2 * GRANT]]);
  const { world } = await read(WORLD);
  expect(moved(world)['faucet_starting_grant']).toEqual([3 * GRANT, [0, 3 * GRANT]]);
});
