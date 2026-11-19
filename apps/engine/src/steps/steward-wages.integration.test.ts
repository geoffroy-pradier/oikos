import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
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
import { neutralEconomy } from '../neutral.integration-fixtures';

// Salaires des intendants à la clôture (#278), contre Supabase local. Chaque test a son monde et ses puits.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
/** La configuration initiale, à paramètres économiques neutres : chaque essai règle le tarif qu'il éprouve (#668). */
const initial = neutralEconomy(INITIAL_CONFIG as GameConfig);
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
/** Un champ coûte 30 oboles par jour, un atelier rien, sans salaire de travailleur ; un intendant, `wage`. */
const dailyOboles = { ...initial.sites.upkeep.dailyOboles, field: 30, workshop: 0 };
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const paying = (wage: number, change: (config: GameConfig) => GameConfig = (config) => config) => ({
  at: async () => {
    const stewards = initial.stewards && { ...initial.stewards, dailyWageOboles: wage };
    const sites = { ...initial.sites, upkeep: { coefficientBps: 10_000, dailyOboles } };
    return { ...loaded, config: change({ ...initial, clock, sites, stewards }) };
  },
});
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, day: number, config = paying(8)) =>
  closeWorld(db, { worldId, now: dailyCloseAt(day, clock), config, steps: [siteUpkeep] });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Un monde, sa cité, une maison dotée de `oboles`, son champ, et un intendant par état donné, chacun dans un
 * moulin de la maison : `new` (impayé depuis l'embauche), `active` (payé par la dernière clôture), `dismissed`
 * (renvoyé) ou `late` (embauché après la clôture). Sites et intendants antidatés, gardes levées.
 */
async function newHouse(oboles: number, states: ('new' | 'active' | 'dismissed' | 'late')[]) {
  const [worldId, cityId, userId, houseId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const recipes = ['grow_wheat', ...states.map(() => 'mill_flour')];
  const ids = await owner.transaction().execute(async (trx) => {
    await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`s-${worldId.slice(0, 12)}`}, 'Test')),
      city as (insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Agora')),
      player as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})),
      house as (insert into game.houses (id, world_id, user_id, name, blazon)
        values (${houseId}, ${worldId}, ${userId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}'))
      insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId})`.execute(
      trx,
    );
    await sql`alter table game.sites disable trigger sites_guard; alter table game.stewards disable trigger stewards_guard`.execute(
      trx,
    );
    const sites = await sql<{
      id: string;
    }>`insert into game.sites (world_id, house_id, city_id, recipe_id, created_at, cycle_started_at)
      select ${worldId}, ${houseId}, ${cityId}, recipe, now() - interval '10 days', now() - interval '10 days'
      from unnest(${recipes}::text[]) with ordinality as listed(recipe, rank) order by rank returning id`.execute(
      trx,
    );
    const stewards = await sql<{ id: string }>`insert into game.stewards
        (world_id, house_id, site_id, name, hired_at, unpaid_since, dismissed_at)
      select ${worldId}, ${houseId}, site, 'Intendant ' || rank, h, case when state = 'active' then null else h end,
        case when state = 'dismissed' then h end
      from unnest(${states}::text[], ${sites.rows.slice(1).map((row) => row.id)}::uuid[]) with ordinality as listed(state, site, rank),
        lateral (select case when state = 'late' then now() else now() - interval '9 days' + rank * interval '1 hour' end as h) hired
      order by rank returning id`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard; alter table game.stewards enable trigger stewards_guard`.execute(
      trx,
    );
    return { sites: sites.rows.map((row) => row.id), stewards: stewards.rows.map((row) => row.id) };
  });
  const [siteId = '', ...mills] = ids.sites;
  const house = { worldId, houseId, siteId, stewardIds: ids.stewards, mills };
  if (oboles > 0) await credit(house, oboles);
  return house;
}
type House = Awaited<ReturnType<typeof newHouse>>;
const credit = ({ worldId, houseId }: House, oboles: number) =>
  sql`with entry as (insert into game.ledger_entries (world_id, kind) values (${worldId}, 'test.seed') returning id)
    insert into game.ledger_lines (entry_id, account_id, amount)
    select entry.id, a.id, case when a.kind = 'house' then ${oboles}::bigint else -${oboles}::bigint end from entry, game.accounts a
    where a.world_id = ${worldId} and ((a.kind = 'house' and a.house_id = ${houseId}) or a.system_key = 'faucet_starting_grant')`.execute(
    owner,
  );
const rows = async <T>(query: ReturnType<typeof sql<T>>) => (await query.execute(db)).rows;
/**
 * Trésorerie, puits de l'entretien et bourses des PNJ du monde, qui reçoivent les salaires (#632), et leur
 * somme, que la clôture ne change pas.
 */
const balances = async ({ worldId, houseId }: House) => {
  const found = await rows(sql<{
    key: string;
    balance: string;
  }>`select coalesce(system_key, 'treasury') as key, balance
    from game.accounts where world_id = ${worldId}
      and ((kind = 'house' and house_id = ${houseId}) or system_key = 'sink_upkeep')
    union all select 'npc_purse', sum(balance) from game.npc_purses() where world_id = ${worldId}`);
  const of = (key: string) => Number(found.find((row) => row.key === key)?.balance);
  return [of('treasury'), of('sink_upkeep'), of('npc_purse')];
};
/** Écritures d'entretien de la maison : leur méta et leurs lignes (compte, montant, nature). */
const entriesOf = ({ houseId }: House) =>
  rows(sql<{ meta: Record<string, unknown>; lines: string[] }>`select e.meta,
      array_agg(case when p.account_id is null then coalesce(a.system_key, 'treasury') else 'npc_purse' end
        || ' ' || l.amount || ' ' || coalesce(l.nature, '-') order by l.amount, a.system_key) as lines
    from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
    left join game.accounts a on a.id = l.account_id left join game.npc_purses() p on p.account_id = l.account_id
    where e.kind = 'upkeep.daily' and e.meta->>'houseId' = ${houseId} group by e.id order by e.created_at`);
/** Intendants actifs (payés par la dernière clôture), dans l'ordre de leur embauche. */
const activeOf = async ({ stewardIds }: House) =>
  (
    await rows(sql<{ id: string; active: boolean }>`select id, unpaid_since is null as active
      from game.stewards where id = any(${stewardIds}::uuid[])`)
  )
    .sort((a, b) => stewardIds.indexOf(a.id) - stewardIds.indexOf(b.id))
    .map((row) => row.active);
/** Site de l'intendant : son moulin. */
const millOf = ({ stewardIds, mills }: House, stewardId?: string) =>
  mills[stewardIds.indexOf(stewardId ?? '')];
/** Salaires des intendants d'un événement `UpkeepSettled`. */
const settled = (
  wagesOboles: number,
  paid: object[],
  unpaid: object[],
  deactivated: unknown[],
  activated: unknown[],
) => ({ wagesOboles, paid, unpaid, deactivated, activated });
const stewardsEvent = async ({ houseId }: House) =>
  (
    await rows(sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = 'UpkeepSettled' and payload->>'houseId' = ${houseId} order by seq`)
  ).map((row) => [row.payload['paidOboles'], row.payload['stewards']]);

describe('salaires des intendants à la clôture (#278)', () => {
  it('chaque intendant en poste paie son jour, avec son site, par une ligne `wages` de l’écriture d’entretien', async () => {
    const house = await newHouse(100, ['new', 'active', 'dismissed', 'late']);
    const [fresh, active] = house.stewardIds;
    expect(await close(house.worldId, TODAY)).toEqual([TODAY]);
    // 30 d'entretien, deux salaires de 8 : 100 − 46 = 54 ; ni l'intendant renvoyé ni le dernier embauché.
    expect(await balances(house)).toEqual([54, 30, 16]);
    const wage = (stewardId?: string) => ({
      stewardId,
      siteId: millOf(house, stewardId),
      oboles: 8,
    });
    expect(await entriesOf(house)).toEqual([
      {
        meta: {
          houseId: house.houseId,
          gameDay: TODAY,
          sites: [{ siteId: house.siteId, oboles: 30, upkeepOboles: 30, wagesOboles: 0 }],
          stewards: [wage(fresh), wage(active)],
        },
        lines: ['treasury -30 upkeep', 'treasury -16 wages', 'npc_purse 16 -', 'sink_upkeep 30 -'],
      },
    ]);
    // Le nouvel intendant est actif, payé pour la première fois ; les autres ne changent pas.
    expect(await activeOf(house)).toEqual([true, true, false, false]);
    expect(await stewardsEvent(house)).toEqual([
      [46, settled(16, [wage(fresh), wage(active)], [], [], [fresh])],
    ]);
    // Rejouée : rien de plus.
    expect(await close(house.worldId, TODAY)).toEqual([]);
    expect(await balances(house)).toEqual([54, 30, 16]);
  });

  it('à court de monnaie : les intendants après le site, en entier ou pas du tout, inactifs jusqu’à la clôture qui les paie', async () => {
    const house = await newHouse(40, ['active', 'active']);
    const [first, second] = house.stewardIds;
    // 40 : le champ (30), puis le premier intendant (8) ; le second (8) ne tient plus dans 2.
    await close(house.worldId, TODAY - 2);
    expect(await balances(house)).toEqual([2, 30, 8]);
    expect(await activeOf(house)).toEqual([true, false]);
    // 2 : le champ est impayé et s'arrête, rien n'est prélevé ; les deux intendants sont inactifs.
    await close(house.worldId, TODAY - 1);
    expect(await balances(house)).toEqual([2, 30, 8]);
    expect(await activeOf(house)).toEqual([false, false]);
    // 2 + 14 = 16 : le champ à l'arrêt ne tient pas (30) ; les deux intendants (16) sont payés et repartent.
    await credit(house, 14);
    await close(house.worldId, TODAY);
    expect(await balances(house)).toEqual([0, 30, 24]);
    expect(await activeOf(house)).toEqual([true, true]);
    const due = (stewardId?: string) => ({
      stewardId,
      siteId: millOf(house, stewardId),
      oboles: 8,
    });
    expect((await stewardsEvent(house)).map(([, stewards]) => stewards)).toEqual([
      settled(8, [due(first)], [due(second)], [second], []),
      settled(0, [], [due(first), due(second)], [first], []),
      settled(16, [due(first), due(second)], [], [], [first, second]),
    ]);
  });

  it('salaire nul : aucune ligne, et l’intendant embauché devient actif', async () => {
    const house = await newHouse(0, ['new']);
    await close(house.worldId, TODAY, paying(0));
    // Le champ impayé (solde nul) s'arrête ; l'intendant ne doit rien, il est payé.
    expect(await balances(house)).toEqual([0, 0, 0]);
    expect(await entriesOf(house)).toEqual([]);
    expect(await activeOf(house)).toEqual([true]);
    expect((await stewardsEvent(house)).map(([, stewards]) => stewards)).toEqual([
      settled(0, [], [], [], house.stewardIds),
    ]);
  });

  it('version sans intendants (retour arrière) : rien n’est prélevé, et aucun intendant n’agit', async () => {
    const house = await newHouse(100, ['new', 'active']);
    const [fresh, active] = house.stewardIds;
    await close(
      house.worldId,
      TODAY,
      paying(8, ({ stewards: _, ...rest }) => rest),
    );
    expect(await balances(house)).toEqual([70, 30, 0]);
    expect(await activeOf(house)).toEqual([false, false]);
    const due = (stewardId?: string) => ({
      stewardId,
      siteId: millOf(house, stewardId),
      oboles: 0,
    });
    expect((await stewardsEvent(house)).map(([, stewards]) => stewards)).toEqual([
      settled(0, [], [due(fresh), due(active)], [active], []),
    ]);
  });

  it('salaires des travailleurs et des intendants : deux lignes `wages` vers le même puits', async () => {
    const staff = { dailyWageOboles: { kalliste: 3 } };
    const house = await newHouse(100, ['active']);
    await close(
      house.worldId,
      TODAY,
      paying(8, (config) => ({ ...config, staff })),
    );
    // Champ : 30 d'entretien, 4 × 3 de salaires ; moulin : 2 × 3 ; intendant : 8. 100 − 56 = 44.
    expect(await balances(house)).toEqual([44, 30, 26]);
    expect((await entriesOf(house)).map((entry) => entry.lines)).toEqual([
      [
        'treasury -30 upkeep',
        'treasury -18 wages',
        'treasury -8 wages',
        'npc_purse 26 -',
        'sink_upkeep 30 -',
      ],
    ]);
    expect(await activeOf(house)).toEqual([true]);
  });

  it('deux cités (#632) : salaires des sites et des intendants versés chacun à la bourse de la cité de son site', async () => {
    // Champ et premier moulin à Kallistè (salaire de 3), second moulin à Elaia (salaire de 5), un intendant par moulin.
    const staff = { dailyWageOboles: { kalliste: 3, elaia: 5 } };
    const house = await newHouse(200, ['active', 'active']);
    const elaia = randomUUID();
    await owner.transaction().execute(async (trx) => {
      await sql`insert into game.cities (id, world_id, slug, name) values (${elaia}, ${house.worldId}, 'elaia', 'Elaia')`.execute(
        trx,
      );
      await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
      await sql`update game.sites set city_id = ${elaia} where id = ${house.mills[1] ?? ''}`.execute(
        trx,
      );
      await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    });
    await close(
      house.worldId,
      TODAY,
      paying(8, (config) => ({ ...config, staff })),
    );
    // Kallistè : champ 4 × 3, moulin 2 × 3, intendant 8 = 26 ; Elaia : moulin 2 × 5, intendant 8 = 18.
    const { rows } = await sql<{ slug: string; balance: string }>`select c.slug, p.balance
      from game.npc_purses() p join game.cities c on c.id = p.city_id
      where p.world_id = ${house.worldId} order by c.slug`.execute(db);
    expect(rows.map((row) => [row.slug, Number(row.balance)])).toEqual([
      ['elaia', 18],
      ['kalliste', 26],
    ]);
    // Toujours un débit de la trésorerie par nature, et une ligne de crédit par bourse.
    expect((await entriesOf(house)).map((entry) => entry.lines)).toEqual([
      [
        'treasury -30 upkeep',
        'treasury -28 wages',
        'treasury -16 wages',
        'npc_purse 18 -',
        'npc_purse 26 -',
        'sink_upkeep 30 -',
      ],
    ]);
  });
});
