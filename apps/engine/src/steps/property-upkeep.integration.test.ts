import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql, type RawBuilder } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyClose } from '../close';
import { closeWorld } from '../scheduler';
import { propertyWear } from './property-wear';
import { siteUpkeep } from './site-upkeep';
import { neutralEconomy } from '../neutral.integration-fixtures';

// Vétusté et entretien des biens immobiliers à la clôture (#256), contre Supabase local. Chaque test a son
// monde, sa maison et ses biens, achetés il y a dix jours (gardes levées le temps d'antidater l'achat).
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
/** La configuration initiale, à paramètres économiques neutres : chaque essai règle le tarif qu'il éprouve (#668). */
const initial = neutralEconomy(INITIAL_CONFIG as GameConfig);
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
/** Maison de ville : 12 par jour, 400 points de vétusté. Immeuble de rapport : 30 par jour, aucune vétusté. */
const [TOWNHOUSE, TENEMENT, WEAR] = [12, 30, 400];
const properties = {
  ...initial.properties,
  sizes: initial.properties.sizes.map((size) =>
    size.id === 'townhouse'
      ? { ...size, dailyUpkeepOboles: TOWNHOUSE, dailyWear: WEAR }
      : { ...size, dailyUpkeepOboles: TENEMENT, dailyWear: 0 },
  ),
};
/** Un champ : 30 par jour, comme dans les tests de l'entretien des sites. */
const sites = {
  ...initial.sites,
  upkeep: {
    coefficientBps: 10_000,
    dailyOboles: { ...initial.sites.upkeep.dailyOboles, field: 30 },
  },
};
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const config = (patch: Partial<GameConfig> = {}) => ({
  at: async () => ({ ...loaded, config: { ...initial, clock, sites, properties, ...patch } }),
});
const STEPS = [propertyWear, siteUpkeep];
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, day = TODAY, settings = config()) =>
  closeWorld(db, { worldId, now: dailyCloseAt(day, clock), config: settings, steps: STEPS });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Un monde, sa cité, une maison dotée de `oboles` et propriétaire des biens de tailles `owned` (achetés
 * d'heure en heure, il y a dix jours, dans l'ordre donné), un bien encore à la cité et des sites.
 */
async function newHouse(oboles: number, owned: string[], recipes: string[] = []) {
  const [worldId, cityId, userId, houseId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  let propertyIds: string[] = [];
  let cityHeld = '';
  await owner.transaction().execute(async (trx) => {
    await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`n-${worldId.slice(0, 12)}`}, 'Test'))
      insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, 'kalliste', 'Port')`.execute(
      trx,
    );
    await sql`with player as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})),
      house as (insert into game.houses (id, world_id, user_id, name, blazon)
        values (${houseId}, ${worldId}, ${userId}, ${`Maison ${houseId.replace(/[^a-f]/g, '').slice(0, 10)}`}, '{}'))
      insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${houseId})`.execute(
      trx,
    );
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`insert into game.sites (world_id, house_id, city_id, recipe_id, created_at, cycle_started_at)
      select ${worldId}, ${houseId}, ${cityId}, recipe, now() - interval '10 days', now() - interval '9 days'
      from unnest(${recipes}::text[]) recipe`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    const created = await sql<{
      id: string;
    }>`insert into game.properties (world_id, city_id, size_id, lot)
      select ${worldId}, ${cityId}, size, rank from unnest(${[...owned, 'townhouse']}::text[]) with ordinality as l (size, rank)
      order by rank returning id`.execute(trx);
    const ids = created.rows.map((row) => row.id);
    propertyIds = ids.slice(0, owned.length);
    cityHeld = ids[owned.length] ?? '';
    // Les contrôles différés de l'insertion d'abord : une table qui en attend ne se modifie pas.
    await sql`set constraints all immediate`.execute(trx);
    await sql`alter table game.properties disable trigger properties_guard`.execute(trx);
    await sql`update game.properties p set owner_house_id = ${houseId},
        acquired_at = now() - interval '10 days' + l.rank * interval '1 hour'
      from unnest(${propertyIds}::uuid[]) with ordinality as l (id, rank) where p.id = l.id`.execute(
      trx,
    );
    await sql`alter table game.properties enable trigger properties_guard`.execute(trx);
  });
  await fund(worldId, houseId, oboles);
  return { worldId, houseId, propertyIds, cityHeld };
}
type House = Awaited<ReturnType<typeof newHouse>>;
async function fund(worldId: string, houseId: string, oboles: number) {
  if (oboles > 0)
    await sql`with entry as (insert into game.ledger_entries (world_id, kind) values (${worldId}, 'test.seed') returning id)
      insert into game.ledger_lines (entry_id, account_id, amount)
      select entry.id, a.id, case when a.kind = 'house' then ${oboles}::bigint else -${oboles}::bigint end from entry, game.accounts a
      where a.world_id = ${worldId} and ((a.kind = 'house' and a.house_id = ${houseId}) or a.system_key = 'faucet_starting_grant')`.execute(
      owner,
    );
}
const rows = async <T>(query: RawBuilder<T>) => (await query.execute(db)).rows;
/** Trésorerie de la maison, puis puits d'entretien des sites et des biens. */
const balances = async ({ worldId, houseId }: House) =>
  (
    await rows(sql<{
      balance: string;
    }>`select balance from game.accounts where world_id = ${worldId}
      and ((kind = 'house' and house_id = ${houseId}) or system_key in ('sink_upkeep', 'sink_property_upkeep'))
      order by kind, system_key`)
  ).map((row) => Number(row.balance));
/** État de chaque bien de la maison puis de celui de la cité, et s'il est impayé. */
const estate = async ({ propertyIds, cityHeld }: House) =>
  (
    await rows(sql<{ condition: number; worn_day: number | null; unpaid: boolean }>`
      select condition, worn_day, upkeep_unpaid_since is not null as unpaid from game.properties
      where id = any(${[...propertyIds, cityHeld]}::uuid[]) order by array_position(${[...propertyIds, cityHeld]}::uuid[], id)`)
  ).map((row) => [row.condition, row.worn_day, row.unpaid]);
const settledOf = async ({ houseId }: House) =>
  (
    await rows(sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = 'UpkeepSettled' and payload->>'houseId' = ${houseId} order by seq`)
  ).map((row) => [row.payload['paidOboles'], row.payload['properties']]);
const linesOf = ({ houseId }: House, day = TODAY) =>
  rows(sql`select coalesce(a.system_key, 'treasury') as account, l.amount, l.nature
    from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
    where e.kind = 'upkeep.daily' and e.meta->>'houseId' = ${houseId} and (e.meta->>'gameDay')::int = ${day}
    order by l.amount, a.system_key`);

describe('biens immobiliers à la clôture quotidienne', () => {
  it('une maison qui n’a que des biens paie leur entretien ; impayé, un bien est constaté, puis levé par la clôture qui le paie', async () => {
    const house = await newHouse(20, ['townhouse', 'tenement']);
    const [townhouse, tenement] = house.propertyIds;
    // 20 : la maison de ville (12) est payée, l'immeuble (30) ne l'est pas.
    expect(await close(house.worldId, TODAY - 1)).toEqual([TODAY - 1]);
    expect(await balances(house)).toEqual([8, 12, 0]);
    expect(await linesOf(house, TODAY - 1)).toEqual([
      { account: 'treasury', amount: '-12', nature: 'upkeep' },
      { account: 'sink_property_upkeep', amount: '12', nature: null },
    ]);
    expect((await estate(house)).map(([, , unpaid]) => unpaid)).toEqual([false, true, false]);
    await fund(house.worldId, house.houseId, 34);
    await close(house.worldId);
    expect(await balances(house)).toEqual([0, 54, 0]);
    expect((await estate(house)).map(([, , unpaid]) => unpaid)).toEqual([false, false, false]);
    const due = (id: string | undefined, oboles: number) => ({ propertyId: id, oboles });
    expect(await settledOf(house)).toEqual([
      [
        12,
        {
          upkeepOboles: 12,
          paid: [due(townhouse, 12)],
          unpaid: [due(tenement, 30)],
          lapsed: [tenement],
          restored: [],
        },
      ],
      [
        42,
        {
          upkeepOboles: 42,
          paid: [due(townhouse, 12), due(tenement, 30)],
          unpaid: [],
          lapsed: [],
          restored: [tenement],
        },
      ],
    ]);
  });

  it('après les sites, avec ce qui reste : le site d’abord, puis les biens dans l’ordre de leur achat', async () => {
    // 45 : le champ (30), puis la maison de ville (12) ; l'immeuble (30) ne tient plus dans 3.
    const house = await newHouse(45, ['townhouse', 'tenement'], ['grow_wheat']);
    await close(house.worldId);
    expect(await balances(house)).toEqual([3, 12, 30]);
    expect(await linesOf(house)).toEqual([
      { account: 'treasury', amount: '-30', nature: 'upkeep' },
      { account: 'treasury', amount: '-12', nature: 'upkeep' },
      { account: 'sink_property_upkeep', amount: '12', nature: null },
      { account: 'sink_upkeep', amount: '30', nature: null },
    ]);
    expect((await estate(house)).map(([, , unpaid]) => unpaid)).toEqual([false, true, false]);
  });

  it('vétusté rejouée : chaque bien s’use une fois par jour de jeu, à la cité comme à une maison, sans passer sous zéro', async () => {
    const house = await newHouse(1_000, ['townhouse', 'tenement']);
    await close(house.worldId, TODAY - 2);
    // La maison de ville et celle de la cité perdent 400 ; l'immeuble ne s'use pas.
    expect(await estate(house)).toEqual([
      [9_600, TODAY - 2, false],
      [10_000, null, false],
      [9_600, TODAY - 2, false],
    ]);
    // Rejouée par deux moteurs puis directement : la clôture déjà jouée ne s'applique pas deux fois.
    expect(
      await Promise.all([close(house.worldId, TODAY - 2), close(house.worldId, TODAY - 2)]),
    ).toEqual([[], []]);
    const replayed = await runDailyClose(db, {
      worldId: house.worldId,
      gameDay: TODAY - 2,
      closeAt: dailyCloseAt(TODAY - 2, clock),
      config: config(),
      steps: STEPS,
      now: new Date(),
    });
    expect(replayed.status).toBe('skipped');
    // L'étape seule, hors d'une clôture qui s'enregistre : la base refuse une seconde usure du jour.
    await expect(
      db.transaction().execute((trx) =>
        propertyWear.run({
          trx,
          worldId: house.worldId,
          gameDay: TODAY - 2,
          closeAt: dailyCloseAt(TODAY - 2, clock),
          config: { ...initial, properties },
        }),
      ),
    ).rejects.toThrow(/wears once per game day|before its close is recorded/);
    expect((await estate(house)).map(([condition]) => condition)).toEqual([9_600, 10_000, 9_600]);
    // Le lendemain, une nouvelle usure ; un bien presque ruiné s'arrête à zéro et n'est plus touché.
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.properties disable trigger properties_guard`.execute(trx);
      await sql`update game.properties set condition = 300 where id = ${house.cityHeld}`.execute(
        trx,
      );
      await sql`alter table game.properties enable trigger properties_guard`.execute(trx);
    });
    await close(house.worldId, TODAY - 1);
    await close(house.worldId);
    expect(await estate(house)).toEqual([
      [8_800, TODAY, false],
      [10_000, null, false],
      [0, TODAY - 1, false],
    ]);
  });

  it('paramètres neutres, taille retirée, bien acheté après la clôture : rien à payer ni à user', async () => {
    const house = await newHouse(100, ['townhouse']);
    await close(house.worldId, TODAY - 1, config({ properties: initial.properties }));
    await close(house.worldId, TODAY, config({ properties: { sizes: [], countsByCity: {} } }));
    expect(await balances(house)).toEqual([100, 0, 0]);
    expect(await settledOf(house)).toEqual([]);
    expect((await estate(house)).map(([condition]) => condition)).toEqual([10_000, 10_000]);
    // Acheté après l'instant de la clôture (jouée en retard) : il ne doit rien ce jour-là.
    const late = await newHouse(100, ['townhouse']);
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.properties disable trigger properties_guard`.execute(trx);
      await sql`update game.properties set acquired_at = now() where id = ${late.propertyIds[0] ?? ''}`.execute(
        trx,
      );
      await sql`alter table game.properties enable trigger properties_guard`.execute(trx);
    });
    await close(late.worldId);
    expect(await balances(late)).toEqual([100, 0, 0]);
  });
});
