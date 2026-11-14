import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  DEFAULT_UPKEEP,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorld } from '../scheduler';
import { siteUpkeep } from './site-upkeep';

// Entretien des sites à la clôture, contre Supabase local. Chaque test a son monde et son puits.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
/** Champ 30, carrière 60, verger 45, coefficient ×1,25 : 38 (37,5), 75 et 57 (56,25) oboles par jour. */
const [FIELD, QUARRY, ORCHARD] = [38, 75, 57];
const dailyOboles = { ...initial.sites.upkeep.dailyOboles, field: 30, quarry: 60, orchard: 45 };
const sites = { ...initial.sites, upkeep: { coefficientBps: 12_500, dailyOboles } };
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const charged = { at: async () => ({ ...loaded, config: { ...initial, clock, sites } }) };
/** Jour de jeu en cours : sa clôture est passée. Les essais jouent ce jour et les deux précédents. */
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, day = TODAY, config = charged) =>
  closeWorld(db, { worldId, now: dailyCloseAt(day, clock), config, steps: [siteUpkeep] });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Un monde, sa cité, et une maison dotée de `oboles` et de sites créés il y a dix jours, d'heure en
 * heure dans l'ordre donné : ils existaient à la clôture. Posé par le propriétaire, garde des sites
 * levée le temps d'antidater leur création.
 */
async function newHouse(oboles: number, recipes: string[]) {
  const [worldId, cityId, userId, houseId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const house = { worldId, cityId, houseId, siteIds: [] as string[] };
  await owner.transaction().execute(async (trx) => {
    await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`u-${worldId.slice(0, 12)}`}, 'Test'))
      insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Agora')`.execute(
      trx,
    );
    await sql`with player as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})),
      house as (insert into game.houses (id, world_id, user_id, name, blazon)
        values (${houseId}, ${worldId}, ${userId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}'))
      insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId})`.execute(
      trx,
    );
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    const sites = await sql<{
      id: string;
    }>`insert into game.sites (world_id, house_id, city_id, recipe_id, created_at, cycle_started_at)
      select ${worldId}, ${houseId}, ${cityId}, recipe, now() - interval '10 days' + rank * interval '1 hour', now() - interval '9 days'
      from unnest(${recipes}::text[]) with ordinality as listed(recipe, rank) order by rank returning id`.execute(
      trx,
    );
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    house.siteIds = sites.rows.map((site) => site.id);
  });
  if (oboles > 0) await credit(house, oboles);
  return house;
}
type House = Awaited<ReturnType<typeof newHouse>>;
/** Verse des oboles à la maison depuis un robinet, par une écriture équilibrée. */
const credit = ({ worldId, houseId }: House, oboles: number) =>
  sql`with entry as (insert into game.ledger_entries (world_id, kind) values (${worldId}, 'test.seed') returning id)
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry.id, a.id, case when a.kind = 'house' then ${oboles}::bigint else -${oboles}::bigint end from entry, game.accounts a
    where a.world_id = ${worldId} and ((a.kind = 'house' and a.house_id = ${houseId}) or a.system_key = 'faucet_starting_grant')`.execute(
    owner,
  );
const one = async <T>(query: ReturnType<typeof sql<T>>) => (await query.execute(db)).rows;
/** Trésorerie de la maison et solde du puits de son monde. */
const balances = async ({ worldId, houseId }: House) =>
  (
    await one(sql<{ balance: string }>`select balance from game.accounts where world_id = ${worldId}
      and ((kind = 'house' and house_id = ${houseId}) or system_key = 'sink_upkeep') order by kind`)
  ).map((row) => Number(row.balance));
/** État de chaque site, dans l'ordre de création : à l'arrêt ou non, et secondes de cycle écoulées. */
const sitesOf = ({ houseId }: House) =>
  one(sql<{ halted: boolean; elapsed: number }>`select halted_at is not null as halted,
    extract(epoch from coalesce(halted_at, now()) - cycle_started_at)::float8 as elapsed
    from game.sites where house_id = ${houseId} order by created_at`);
const upkeepEvents = async ({ houseId }: House) =>
  (
    await one(sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = 'UpkeepSettled' and payload->>'houseId' = ${houseId} order by seq`)
  ).map((row) => row.payload);
const entriesOf = ({ houseId }: House) =>
  one(sql<{
    meta: unknown;
    amounts: string[];
  }>`select e.meta, array_agg(l.amount order by l.amount) as amounts
    from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
    where e.kind = 'upkeep.daily' and e.meta->>'houseId' = ${houseId} group by e.id order by e.created_at`);
/** Ordre de lecture du résumé : maisons, oboles payées, sites payés, sites impayés, arrêtés, relancés. */
const SUMMARY_KEYS = ['houses', 'paidOboles', 'sitesPaid', 'sitesUnpaid', 'halted', 'resumed'];
/** Résumé de l'étape enregistré avec chaque clôture du monde, dans l'ordre des jours de jeu. */
const summariesOf = async (worldId: string) =>
  (
    await one(sql<{
      summary: { siteUpkeep: Record<string, number> };
    }>`select summary from game.daily_closes
      where world_id = ${worldId} order by game_day`)
  ).map(({ summary }) => {
    expect(Object.keys(summary.siteUpkeep).sort()).toEqual([...SUMMARY_KEYS].sort());
    return SUMMARY_KEYS.map((key) => summary.siteUpkeep[key]);
  });

describe('entretien des sites à la clôture quotidienne', () => {
  it('chaque site paie son jour d’entretien au puits, une seule fois par jour de jeu', async () => {
    const house = await newHouse(1_000, ['grow_wheat', 'dig_clay', 'grow_olives']);
    const [a, b, c] = house.siteIds;
    // La première clôture est demandée par trois moteurs à la fois : un seul la joue, un seul prélèvement.
    const engines = await Promise.all([1, 2, 3].map(() => close(house.worldId)));
    expect(engines.flat()).toEqual([TODAY]);
    // 38 + 75 + 57 = 170 : 1 000 − 170 = 830, et le puits a tout reçu.
    expect(await balances(house)).toEqual([830, 170]);
    const paid = [
      { siteId: a, oboles: FIELD },
      { siteId: b, oboles: QUARRY },
      { siteId: c, oboles: ORCHARD },
    ];
    expect(await entriesOf(house)).toEqual([
      { meta: { houseId: house.houseId, gameDay: TODAY, sites: paid }, amounts: ['-170', '170'] },
    ]);
    expect((await sitesOf(house)).map((site) => site.halted)).toEqual([false, false, false]);
    expect(await summariesOf(house.worldId)).toEqual([[1, 170, 3, 0, 0, 0]]);
    // Rejouée : rien de plus.
    expect(await close(house.worldId)).toEqual([]);
    expect(await balances(house)).toEqual([830, 170]);
    // Même si l'étape était relancée hors de la clôture, la base refuse le second prélèvement.
    const { config } = await charged.at();
    const [worldId, closeAt] = [house.worldId, dailyCloseAt(TODAY, clock)];
    const context = { worldId, gameDay: TODAY, closeAt, config };
    const again = db.transaction().execute((trx) => siteUpkeep.run({ ...context, trx }));
    await expect(again).rejects.toMatchObject({ constraint: 'ledger_entries_upkeep_once' });
    expect(await balances(house)).toEqual([830, 170]);
  });

  it('maison à court de monnaie : sites payés en entier dans l’ordre de création, les autres à l’arrêt, puis relancés', async () => {
    const house = await newHouse(100, ['grow_wheat', 'dig_clay', 'grow_olives']);
    const [, b, c] = house.siteIds;
    // 100 : champ 38 (reste 62), carrière 75 impayée, verger 57 (reste 5).
    await close(house.worldId, TODAY - 2);
    expect(await balances(house)).toEqual([5, 95]);
    expect((await sitesOf(house)).map((site) => site.halted)).toEqual([false, true, false]);
    // 5 + 70 = 75 : champ 38 (reste 37), carrière et verger impayés. La carrière, déjà à l'arrêt, y reste.
    await credit(house, 70);
    await close(house.worldId, TODAY - 1);
    expect(await balances(house)).toEqual([37, 133]);
    expect((await sitesOf(house)).map((site) => site.halted)).toEqual([false, true, true]);
    // Deux heures passent à l'arrêt (garde levée pour antidater les arrêts).
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
      await sql`update game.sites set halted_at = halted_at - interval '2 hours' where house_id = ${house.houseId}`.execute(
        trx,
      );
      await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    });
    const before = await sitesOf(house);
    // 37 + 163 = 200 : tout est payé (170, reste 30) et les deux sites repartent.
    await credit(house, 163);
    await close(house.worldId, TODAY);
    expect(await balances(house)).toEqual([30, 303]);
    const after = await sitesOf(house);
    expect(after.map((site) => site.halted)).toEqual([false, false, false]);
    // Le temps passé à l'arrêt n'est pas compté : neuf jours de cycle moins deux heures, avant comme après.
    // (à une seconde près : l'essai lui-même prend quelques millisecondes).
    for (const site of [...before.slice(1), ...after.slice(1)])
      expect(Math.abs(site.elapsed - (9 * 86_400 - 7_200))).toBeLessThan(1);
    expect(await summariesOf(house.worldId)).toEqual([
      [1, 95, 2, 1, 1, 0],
      [1, 38, 1, 2, 1, 0],
      [1, 170, 3, 0, 0, 2],
    ]);
    // Chaque écriture ne porte que les sites payés ce jour-là.
    const [first] = house.siteIds;
    expect((await entriesOf(house)).map((entry) => entry.meta)).toMatchObject([
      {
        gameDay: TODAY - 2,
        sites: [
          { siteId: first, oboles: FIELD },
          { siteId: c, oboles: ORCHARD },
        ],
      },
      { gameDay: TODAY - 1, sites: [{ siteId: first, oboles: FIELD }] },
      { gameDay: TODAY, sites: [{ siteId: first }, { siteId: b, oboles: QUARRY }, { siteId: c }] },
    ]);
  });

  it('ne doivent rien : un site créé après l’instant de la clôture, un site dont la recette a quitté la configuration', async () => {
    const house = await newHouse(500, ['grow_wheat', 'grow_wheat', 'dig_clay']);
    const [first, late, retired] = house.siteIds;
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
      // Le deuxième champ naît une seconde après la clôture ; la carrière exploite une recette retirée.
      await sql`update game.sites set created_at = ${dailyCloseAt(TODAY, clock)}::timestamptz + interval '1 second',
        cycle_started_at = now() where id = ${late}`.execute(trx);
      await sql`update game.sites set recipe_id = 'retired_recipe' where id = ${retired}`.execute(
        trx,
      );
      await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    });
    await close(house.worldId);
    // Un seul entretien, celui du premier champ : 500 − 38 = 462. Personne n'est à l'arrêt.
    expect(await balances(house)).toEqual([462, FIELD]);
    expect((await sitesOf(house)).map((site) => site.halted)).toEqual([false, false, false]);
    expect((await entriesOf(house)).map((entry) => entry.meta)).toEqual([
      { houseId: house.houseId, gameDay: TODAY, sites: [{ siteId: first, oboles: FIELD }] },
    ]);
    // L'événement dit la même chose que l'écriture : le site sans tarif n'y figure pas comme payé.
    expect(await upkeepEvents(house)).toMatchObject([
      {
        paidOboles: FIELD,
        paid: [{ siteId: first, oboles: FIELD }],
        unpaid: [],
        halted: [],
        resumed: [],
      },
    ]);
  });

  it('rien à payer : maison sans monnaie arrêtée sans écriture, site sans tarif relancé sans payer, configuration sans entretien', async () => {
    // Trésorerie vide : le champ s'arrête, aucune écriture (une écriture nulle n'existe pas).
    const broke = await newHouse(0, ['grow_wheat']);
    await close(broke.worldId);
    expect([await balances(broke), await entriesOf(broke)]).toEqual([[0, 0], []]);
    expect((await sitesOf(broke)).map((site) => site.halted)).toEqual([true]);
    expect(await summariesOf(broke.worldId)).toEqual([[1, 0, 0, 1, 1, 0]]);
    // Site à l'arrêt dont la recette a quitté la configuration : dû nul, il repart sans rien payer.
    const retired = await newHouse(0, ['grow_wheat']);
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
      await sql`update game.sites set recipe_id = 'retired_recipe', halted_at = now() - interval '1 hour'
        where house_id = ${retired.houseId}`.execute(trx);
      await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    });
    await close(retired.worldId);
    expect([await sitesOf(retired), await entriesOf(retired)]).toMatchObject([
      [{ halted: false }],
      [],
    ]);
    expect(await summariesOf(retired.worldId)).toEqual([[1, 0, 0, 0, 0, 1]]);
    // Configuration publiée avant l'entretien : rien n'est dû, la maison n'est pas concernée du tout.
    const old = await newHouse(0, ['grow_wheat', 'dig_clay']);
    const before = { ...initial, clock, sites: { ...initial.sites, upkeep: DEFAULT_UPKEEP } };
    await close(old.worldId, TODAY, { at: async () => ({ ...loaded, config: before }) });
    expect((await sitesOf(old)).map((site) => site.halted)).toEqual([false, false]);
    expect([await entriesOf(old), await summariesOf(old.worldId)]).toEqual([
      [],
      [[0, 0, 0, 0, 0, 0]],
    ]);
  });

  it('récolte validée pendant la clôture : le site s’arrête quand même, au début de son nouveau cycle', async () => {
    const house = await newHouse(0, ['grow_wheat']);
    const { config } = await charged.at();
    // La transaction de la clôture commence : son « maintenant » est fixé ici.
    const trx = await db.startTransaction().execute();
    const { rows } = await sql<{ started: Date }>`select now() as started`.execute(trx);
    // Une récolte de site plein est validée entre-temps : le cycle repart après le début de la clôture.
    await sql`update game.sites set cycle_started_at = now() where house_id = ${house.houseId}`.execute(
      db,
    );
    const context = {
      worldId: house.worldId,
      gameDay: TODAY,
      closeAt: dailyCloseAt(TODAY, clock),
      config,
    };
    const summary = await siteUpkeep.run({ ...context, trx }).finally(() => trx.commit().execute());
    expect(summary).toMatchObject({ sitesUnpaid: 1, halted: 1 });
    const halt = await one(sql<{
      at_cycle: boolean;
      after_start: boolean;
    }>`select halted_at = cycle_started_at as at_cycle,
      halted_at > ${rows[0]?.started}::timestamptz as after_start from game.sites where house_id = ${house.houseId}`);
    expect(halt).toEqual([{ at_cycle: true, after_start: true }]);
  });

  it('un événement de domaine par maison concernée : payé, impayé, sites arrêtés puis relancés ; aucun pour une maison à qui rien n’est demandé', async () => {
    const house = await newHouse(100, ['grow_wheat', 'dig_clay', 'grow_olives']);
    const [a, b, c] = house.siteIds;
    await close(house.worldId, TODAY - 1);
    await credit(house, 165);
    await close(house.worldId, TODAY);
    const [field, quarry, orchard] = [
      { siteId: a, oboles: FIELD },
      { siteId: b, oboles: QUARRY },
      { siteId: c, oboles: ORCHARD },
    ];
    const settled = { houseId: house.houseId, halted: [], resumed: [], unpaid: [] };
    // 100 : champ et verger payés (95), carrière arrêtée. Puis 5 + 165 = 170 : tout est payé, elle repart.
    expect(await upkeepEvents(house)).toEqual([
      {
        ...settled,
        gameDay: TODAY - 1,
        paidOboles: 95,
        paid: [field, orchard],
        unpaid: [quarry],
        halted: [b],
      },
      { ...settled, gameDay: TODAY, paidOboles: 170, paid: [field, quarry, orchard], resumed: [b] },
    ]);
    const free = await newHouse(50, ['grow_wheat']);
    const before = { ...initial, clock, sites: { ...initial.sites, upkeep: DEFAULT_UPKEEP } };
    await close(free.worldId, TODAY, { at: async () => ({ ...loaded, config: before }) });
    expect(await upkeepEvents(free)).toEqual([]);
  });

  it('jamais de solde négatif : à une obole près, rien n’est prélevé et le site s’arrête ; à l’obole juste, la trésorerie tombe à zéro', async () => {
    const short = await newHouse(FIELD - 1, ['grow_wheat']);
    const exact = await newHouse(FIELD, ['grow_wheat']);
    for (const house of [short, exact]) await close(house.worldId);
    expect([await balances(short), await balances(exact)]).toEqual([
      [FIELD - 1, 0],
      [0, FIELD],
    ]);
    const halted = async (house: House) => (await sitesOf(house)).map((site) => site.halted);
    expect([await halted(short), await halted(exact)]).toEqual([[true], [false]]);
    const unpaid = [{ siteId: short.siteIds[0], oboles: FIELD }];
    expect(await upkeepEvents(short)).toMatchObject([
      { paidOboles: 0, paid: [], unpaid, halted: short.siteIds },
    ]);
  });

  it('la monnaie sous séquestre n’est pas comptée : le site s’arrête, le séquestre reste intact', async () => {
    const house = await newHouse(200, ['grow_wheat']);
    // Un achat en attente de 20 unités à 10 oboles retient les 200 oboles de la maison.
    await owner.transaction().execute(async (trx) => {
      await sql`insert into game.accounts (world_id, kind, house_id) values (${house.worldId}, 'escrow', ${house.houseId})`.execute(
        trx,
      );
      await sql`insert into game.orders (world_id, city_id, house_id, good_id, side, price, quantity, remaining)
        values (${house.worldId}, ${house.cityId}, ${house.houseId}, 'wheat', 'buy', 10, 20, 20)`.execute(
        trx,
      );
      await sql`with entry as (insert into game.ledger_entries (world_id, kind) values (${house.worldId}, 'market.escrow_hold') returning id)
        insert into game.ledger_lines (entry_id, account_id, amount)
        select entry.id, a.id, case when a.kind = 'escrow' then 200 else -200 end from entry, game.accounts a
        where a.house_id = ${house.houseId}`.execute(trx);
    });
    await close(house.worldId);
    expect(await balances(house)).toEqual([0, 0]);
    expect((await sitesOf(house)).map((site) => site.halted)).toEqual([true]);
    const escrow = await one(sql<{ balance: string }>`select balance from game.accounts
      where house_id = ${house.houseId} and kind = 'escrow'`);
    expect(escrow).toEqual([{ balance: '200' }]);
  });
});
