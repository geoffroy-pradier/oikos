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
import { closeWorld } from '../scheduler';
import { siteUpkeep } from './site-upkeep';

// Entretien des navires à la clôture (#252), contre Supabase local. Chaque test a son monde et ses puits.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
/** Champ : ⌈30 × 1,25⌉ = 38 par jour. Caboteur 25, navire rond 40. */
const [COASTER, ROUND] = [25, 40];
const sites = {
  ...initial.sites,
  upkeep: {
    coefficientBps: 12_500,
    dailyOboles: { ...initial.sites.upkeep.dailyOboles, field: 30 },
  },
};
const upkeepOf = { coaster: COASTER, round_ship: ROUND } as Record<string, number>;
const ships = (classes = initial.ships.classes) => ({
  ...initial.ships,
  classes: classes.map((row) => ({ ...row, dailyUpkeepOboles: upkeepOf[row.id] ?? 0 })),
});
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const configWith = (patch: Partial<GameConfig>) => ({
  at: async () => ({ ...loaded, config: { ...initial, clock, sites, ships: ships(), ...patch } }),
});
const charged = configWith({});
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, day = TODAY, config = charged) =>
  closeWorld(db, { worldId, now: dailyCloseAt(day, clock), config, steps: [siteUpkeep] });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Un monde, sa cité, une maison dotée de `oboles`, des sites et des navires créés il y a dix jours, d'heure
 * en heure dans l'ordre donné. Posé par le propriétaire, gardes levées le temps d'antidater leur création.
 */
async function newHouse(oboles: number, classes: string[], recipes: string[] = []) {
  const [worldId, cityId, userId, houseId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const house = { worldId, houseId, shipIds: [] as string[] };
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
    await sql`alter table game.ships disable trigger ships_guard`.execute(trx);
    await sql`insert into game.sites (world_id, house_id, city_id, recipe_id, created_at, cycle_started_at)
      select ${worldId}, ${houseId}, ${cityId}, recipe, now() - interval '10 days', now() - interval '9 days'
      from unnest(${recipes}::text[]) recipe`.execute(trx);
    const created = await sql<{
      id: string;
    }>`insert into game.ships (world_id, house_id, class_id, docked_city_id, created_at)
      select ${worldId}, ${houseId}, class, ${cityId}, now() - interval '10 days' + rank * interval '1 hour'
      from unnest(${classes}::text[]) with ordinality as listed(class, rank) order by rank returning id`.execute(
      trx,
    );
    await sql`alter table game.ships enable trigger ships_guard`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
    house.shipIds = created.rows.map((row) => row.id);
  });
  if (oboles > 0)
    await sql`with entry as (insert into game.ledger_entries (world_id, kind) values (${worldId}, 'test.seed') returning id)
      insert into game.ledger_lines (entry_id, account_id, amount)
      select entry.id, a.id, case when a.kind = 'house' then ${oboles}::bigint else -${oboles}::bigint end from entry, game.accounts a
      where a.world_id = ${worldId} and ((a.kind = 'house' and a.house_id = ${houseId}) or a.system_key = 'faucet_starting_grant')`.execute(
      owner,
    );
  return house;
}
type House = Awaited<ReturnType<typeof newHouse>>;
const rows = async <T>(query: RawBuilder<T>) => (await query.execute(db)).rows;
/** Trésorerie de la maison, puits d'entretien des sites, puits d'entretien des navires. */
const balances = async ({ worldId, houseId }: House) =>
  (
    await rows(sql<{
      balance: string;
    }>`select balance from game.accounts where world_id = ${worldId}
      and ((kind = 'house' and house_id = ${houseId}) or system_key in ('sink_upkeep', 'sink_ship_upkeep'))
      order by kind, system_key desc`)
  ).map((row) => Number(row.balance));
/** Navires désarmés de la maison, par rang de création. */
const laidUp = async ({ houseId }: House) =>
  (
    await rows(sql<{ laid: boolean }>`select laid_up_at is not null as laid from game.ships
      where house_id = ${houseId} order by created_at`)
  ).map((row) => row.laid);
const shipsSettled = async ({ houseId }: House) =>
  (
    await rows(sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = 'UpkeepSettled' and payload->>'houseId' = ${houseId} order by seq`)
  ).map((row) => [row.payload['paidOboles'], row.payload['ships']]);
/** Lignes de l'écriture d'entretien du jour : compte, montant, nature. */
const linesOf = ({ houseId }: House, day = TODAY) =>
  rows(sql`select coalesce(a.system_key, 'treasury') as account, l.amount, l.nature
    from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id join game.accounts a on a.id = l.account_id
    where e.kind = 'upkeep.daily' and e.meta->>'houseId' = ${houseId} and (e.meta->>'gameDay')::int = ${day}
    order by l.amount, a.system_key`);

describe('entretien des navires à la clôture quotidienne', () => {
  it('une maison sans site paie l’entretien de ses navires, par une ligne marquée vers son puits', async () => {
    const house = await newHouse(100, ['coaster', 'round_ship']);
    const [a, b] = house.shipIds;
    await close(house.worldId);
    // 25 + 40 = 65 : 100 − 65 = 35, le puits des navires a tout reçu, celui des sites rien.
    expect(await balances(house)).toEqual([35, 0, 65]);
    expect(await linesOf(house)).toEqual([
      { account: 'treasury', amount: '-65', nature: 'upkeep' },
      { account: 'sink_ship_upkeep', amount: '65', nature: null },
    ]);
    const paid = [
      { shipId: a, oboles: COASTER },
      { shipId: b, oboles: ROUND },
    ];
    expect(await shipsSettled(house)).toEqual([
      [65, { upkeepOboles: 65, paid, unpaid: [], laidUp: [], rearmed: [] }],
    ]);
    expect(await laidUp(house)).toEqual([false, false]);
  });

  it('après les sites, avec ce qui reste : un navire impayé est désarmé, puis réarmé par une clôture qui le paie', async () => {
    const house = await newHouse(70, ['round_ship', 'coaster'], ['grow_wheat']);
    const [round, coaster] = house.shipIds;
    // 70 : champ 38 (reste 32), navire rond 40 impayé, caboteur 25 (reste 7).
    await close(house.worldId, TODAY - 2);
    expect(await balances(house)).toEqual([7, 38, 25]);
    expect(await laidUp(house)).toEqual([true, false]);
    expect(await linesOf(house, TODAY - 2)).toEqual([
      { account: 'treasury', amount: '-38', nature: 'upkeep' },
      { account: 'treasury', amount: '-25', nature: 'upkeep' },
      { account: 'sink_ship_upkeep', amount: '25', nature: null },
      { account: 'sink_upkeep', amount: '38', nature: null },
    ]);
    // 7 : ni le champ ni les navires. Le navire rond reste désarmé, le caboteur l'est à son tour.
    await close(house.worldId, TODAY - 1);
    expect(await balances(house)).toEqual([7, 38, 25]);
    expect(await laidUp(house)).toEqual([true, true]);
    // De quoi tout payer : 38 + 40 + 25 = 103, les deux navires réarmés.
    await sql`with entry as (insert into game.ledger_entries (world_id, kind) values (${house.worldId}, 'test.seed') returning id)
      insert into game.ledger_lines (entry_id, account_id, amount)
      select entry.id, a.id, case when a.kind = 'house' then 96 else -96 end from entry, game.accounts a
      where a.world_id = ${house.worldId} and ((a.kind = 'house' and a.house_id = ${house.houseId}) or a.system_key = 'faucet_starting_grant')`.execute(
      owner,
    );
    await close(house.worldId);
    expect(await balances(house)).toEqual([0, 76, 90]);
    expect(await laidUp(house)).toEqual([false, false]);
    const unpaid = (...ids: (string | undefined)[]) =>
      ids.map((shipId) => ({ shipId, oboles: shipId === round ? ROUND : COASTER }));
    expect(await shipsSettled(house)).toEqual([
      [
        63,
        {
          upkeepOboles: 25,
          paid: unpaid(coaster),
          unpaid: unpaid(round),
          laidUp: [round],
          rearmed: [],
        },
      ],
      [
        0,
        {
          upkeepOboles: 0,
          paid: [],
          unpaid: unpaid(round, coaster),
          laidUp: [coaster],
          rearmed: [],
        },
      ],
      [
        103,
        {
          upkeepOboles: 65,
          paid: unpaid(round, coaster),
          unpaid: [],
          laidUp: [],
          rearmed: [round, coaster],
        },
      ],
    ]);
  });

  it('paramètres neutres, classe retirée, navire acquis après la clôture : rien à payer', async () => {
    // Configuration initiale : entretien nul. Rien n'est prélevé, aucune écriture, aucun événement.
    const neutral = await newHouse(10, ['coaster']);
    await close(neutral.worldId, TODAY, configWith({ ships: initial.ships }));
    expect([await balances(neutral), await linesOf(neutral), await shipsSettled(neutral)]).toEqual([
      [10, 0, 0],
      [],
      [],
    ]);
    // Une classe retirée de la configuration ne doit rien ; désarmé, son navire est réarmé sans payer.
    const retired = await newHouse(0, ['round_ship', 'coaster']);
    await close(retired.worldId, TODAY - 1);
    expect(await laidUp(retired)).toEqual([true, true]);
    const onlyCoasters = configWith({
      ships: ships(initial.ships.classes.filter((row) => row.id === 'coaster')),
    });
    await close(retired.worldId, TODAY, onlyCoasters);
    expect(await laidUp(retired)).toEqual([false, true]);
    // Un navire acquis à l'instant de la clôture ou après ne doit rien pour ce jour.
    const late = await newHouse(0, []);
    await sql`insert into game.ships (world_id, house_id, class_id, docked_city_id)
      select world_id, ${late.houseId}, 'coaster', id from game.cities where world_id = ${late.worldId}`.execute(
      owner,
    );
    await close(late.worldId, TODAY - 1);
    expect([await laidUp(late), await shipsSettled(late)]).toEqual([[false], []]);
  });
});
