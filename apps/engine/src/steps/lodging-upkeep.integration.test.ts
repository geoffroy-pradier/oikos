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
import { laborMarket } from './labor-market';
import {
  laborMarketOf,
  laborWorld,
  purseCredits,
  type LaborWorld,
} from './labor.integration-fixtures';
import { siteUpkeep } from './site-upkeep';

// Salaire du jour et hébergement chez les PNJ payés avec l'entretien (#258), contre Supabase local.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
/**
 * Sans entretien des sites ni des biens : le dû d'un site est ses salaires (10 par travailleur) et
 * l'hébergement de ses non logés, de base 5, ×1 sans pénurie jusqu'à ×3 à pénurie complète.
 */
const config: GameConfig = {
  ...initial,
  clock,
  sites: { ...initial.sites, upkeep: { ...initial.sites.upkeep, coefficientBps: 0 } },
  staff: { dailyWageOboles: { kalliste: 10, elaia: 0, ampelos: 0, halos: 0 } },
  labor: {
    workingShareBps: {},
    wage: { minBps: 10_000, maxBps: 10_000, slopeBps: 0 },
    lodging: { baseOboles: 5, minBps: 10_000, maxBps: 30_000, slopeBps: 20_000 },
  },
};
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, settings: GameConfig = config) =>
  closeWorld(db, {
    worldId,
    now: dailyCloseAt(TODAY, clock),
    config: { at: async () => ({ ...loaded, config: settings }) },
    steps: [laborMarket, siteUpkeep],
  });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Soldes du monde : trésorerie de chaque maison, puis salaires et hébergement reçus par les bourses des PNJ. */
const balances = async ({ worldId, houses }: LaborWorld) => {
  const { rows } = await sql<{
    house_id: string | null;
    system_key: string | null;
    balance: string;
  }>`
    select house_id, system_key, balance from game.accounts where world_id = ${worldId}`.execute(
    db,
  );
  const of = (match: (row: (typeof rows)[number]) => boolean) =>
    Number(rows.find(match)?.balance ?? Number.NaN);
  // Salaires et hébergement vont aux bourses des PNJ (#632) : ce qu'elles ont reçu.
  const { wages, lodging } = await purseCredits(db, worldId);
  return [...houses.map(({ houseId }) => of((row) => row.house_id === houseId)), wages, lodging];
};
/** Écritures de la maison : nature, puis montants de ses lignes. */
const entriesOf = async (houseId: string) =>
  (
    await sql<{
      kind: string;
      amounts: string[];
    }>`select e.kind, array_agg(l.amount order by l.amount) as amounts
      from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
      where e.kind in ('upkeep.daily', 'lodging.daily') and e.meta->>'houseId' = ${houseId}
      group by e.id order by e.kind`.execute(db)
  ).rows.map((row) => [row.kind, row.amounts.map(Number)]);
const eventOf = async (houseId: string) =>
  (
    await sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = 'UpkeepSettled' and payload->>'houseId' = ${houseId}`.execute(db)
  ).rows[0]?.payload;
const halted = async (siteIds: string[]) =>
  (
    await sql<{ halted: boolean }>`select halted_at is not null as halted from game.sites
      where id = any(${siteIds}::uuid[]) order by created_at`.execute(db)
  ).rows.map((row) => row.halted);

describe('hébergement des travailleurs sans logement (#258)', () => {
  it('logés d’abord sur le site le plus ancien ; les autres paient une nuit, dans une écriture à part', async () => {
    // Alice : deux champs (4 travailleurs chacun) et une maison de ville (4 logements). Pénurie 4 sur 8 : ×2,
    // soit 10 la nuit ; le second champ doit 40 de salaires et 40 d'hébergement.
    const world = await laborWorld(owner, {
      houses: [
        {
          oboles: 500,
          sites: [
            { city: 'kalliste', recipe: 'grow_wheat' },
            { city: 'kalliste', recipe: 'grow_wheat' },
          ],
          properties: [{ city: 'kalliste', size: 'townhouse' }],
        },
      ],
    });
    const [alice] = world.houses;
    const before = await balances(world);
    await close(world.worldId);
    expect(await balances(world)).toEqual([380, 80, 40]);
    // Conservation : ce que la maison perd, les puits le détruisent.
    expect((await balances(world)).reduce((a, b) => a + b)).toBe(before.reduce((a, b) => a + b));
    expect(await entriesOf(alice?.houseId ?? '')).toEqual([
      ['lodging.daily', [-40, 40]],
      ['upkeep.daily', [-80, 80]],
    ]);
    const [first, second] = alice?.siteIds ?? [];
    expect(await eventOf(alice?.houseId ?? '')).toMatchObject({
      paidOboles: 120,
      wagesOboles: 80,
      lodgingOboles: 40,
      paid: [
        { siteId: first, oboles: 40, upkeepOboles: 0, wagesOboles: 40 },
        { siteId: second, oboles: 80, upkeepOboles: 0, wagesOboles: 40, lodgingOboles: 40 },
      ],
      unpaid: [],
    });
  });

  it('en entier ou pas du tout : un site dont l’hébergement ne peut être payé s’arrête, sans rien payer', async () => {
    const world = await laborWorld(owner, {
      houses: [
        {
          oboles: 100,
          sites: [
            { city: 'kalliste', recipe: 'grow_wheat' },
            { city: 'kalliste', recipe: 'grow_wheat' },
          ],
          properties: [{ city: 'kalliste', size: 'townhouse' }],
        },
      ],
    });
    const [alice] = world.houses;
    await close(world.worldId);
    // 40 pour le premier ; il reste 60, le second en doit 80 : arrêté, sans hébergement payé.
    expect(await balances(world)).toEqual([60, 40, 0]);
    expect(await entriesOf(alice?.houseId ?? '')).toEqual([['upkeep.daily', [-40, 40]]]);
    expect(await halted(alice?.siteIds ?? [])).toEqual([false, true]);
    expect(await eventOf(alice?.houseId ?? '')).toMatchObject({
      paidOboles: 40,
      unpaid: [{ oboles: 80, wagesOboles: 40, lodgingOboles: 40 }],
    });
  });

  it('une maison logée par un bail ne paie aucun hébergement ; son bailleur, sans logement, paie le sien', async () => {
    const world = await laborWorld(owner, {
      houses: [
        {
          oboles: 500,
          sites: [{ city: 'kalliste', recipe: 'grow_wheat' }],
          properties: [{ city: 'kalliste', size: 'townhouse' }],
        },
        { oboles: 500, sites: [{ city: 'kalliste', recipe: 'grow_olives' }] },
      ],
      leases: [{ landlord: 0, property: 0, tenant: 1 }],
    });
    const [alice, bob] = world.houses;
    await close(world.worldId);
    // 4 non logés sur 8 : 10 la nuit. Alice paie 40 de salaires et 40 d'hébergement, Bob ses salaires.
    expect(await balances(world)).toEqual([420, 460, 80, 40]);
    expect(await entriesOf(bob?.houseId ?? '')).toEqual([['upkeep.daily', [-40, 40]]]);
    expect(await entriesOf(alice?.houseId ?? '')).toEqual([
      ['lodging.daily', [-40, 40]],
      ['upkeep.daily', [-40, 40]],
    ]);
  });

  it('configuration neutre : ni hébergement ni écriture à part, un événement comme avant', async () => {
    const world = await laborWorld(owner, {
      houses: [{ oboles: 500, sites: [{ city: 'kalliste', recipe: 'grow_wheat' }] }],
    });
    const [alice] = world.houses;
    await close(world.worldId, {
      ...config,
      labor: { ...config.labor, lodging: { ...config.labor.lodging, baseOboles: 0 } },
    });
    expect(await balances(world)).toEqual([460, 40, 0]);
    expect(await entriesOf(alice?.houseId ?? '')).toEqual([['upkeep.daily', [-40, 40]]]);
    const event = await eventOf(alice?.houseId ?? '');
    expect(event).not.toHaveProperty('lodgingOboles');
    expect(event?.['paid']).toEqual([
      { siteId: alice?.siteIds[0], oboles: 40, upkeepOboles: 0, wagesOboles: 40 },
    ]);
  });

  describe('bien d’un bailleur dont l’entretien change ce jour : le locataire paie selon l’état d’avant, quel que soit l’ordre des maisons', () => {
    const withPropertyUpkeep: GameConfig = {
      ...config,
      properties: {
        ...config.properties,
        sizes: config.properties.sizes.map((size) => ({ ...size, dailyUpkeepOboles: 12 })),
      },
    };
    /** Alice loue sa maison de ville à Bob ; `landlordFirst` : Alice passe avant Bob à la clôture. */
    const leased = async (landlordFirst: boolean, alice: number, unpaid: boolean) => {
      const [low, high] = [randomUUID(), randomUUID()].sort();
      return laborWorld(owner, {
        houseIds: landlordFirst ? [low ?? '', high ?? ''] : [high ?? '', low ?? ''],
        houses: [
          {
            oboles: alice,
            sites: [],
            properties: [{ city: 'kalliste', size: 'townhouse', unpaid }],
          },
          { oboles: 500, sites: [{ city: 'kalliste', recipe: 'grow_olives' }] },
        ],
        leases: [{ landlord: 0, property: 0, tenant: 1 }],
      });
    };
    const lodgingPaidBy = async (houseId: string) =>
      (
        await sql<{ amount: string }>`select coalesce(sum(l.amount), 0) as amount
          from game.ledger_entries e join game.ledger_lines l on l.entry_id = e.id
          join game.npc_purses() p on p.account_id = l.account_id
          where e.kind = 'lodging.daily' and e.meta->>'houseId' = ${houseId}`.execute(db)
      ).rows.map((row) => Number(row.amount))[0];
    const unpaidSince = async (world: LaborWorld) =>
      (
        await sql<{ unpaid: boolean }>`select upkeep_unpaid_since is not null as unpaid
          from game.properties where id = ${world.houses[0]?.propertyIds[0]}`.execute(db)
      ).rows[0]?.unpaid;

    for (const landlordFirst of [true, false])
      it(`devenu impayé : Bob, logé ce jour, ne paie rien (${landlordFirst ? 'bailleur' : 'locataire'} d’abord)`, async () => {
        const world = await leased(landlordFirst, 0, false);
        await close(world.worldId, withPropertyUpkeep);
        expect(await unpaidSince(world)).toBe(true);
        expect(await lodgingPaidBy(world.houses[1]?.houseId ?? '')).toBe(0);
        expect(await laborMarketOf(db, world.cityIds['kalliste'] ?? '')).toMatchObject([
          { employed: 4, unhoused: 0 },
        ]);
      });

    for (const landlordFirst of [true, false])
      it(`impayé réglé ce jour : Bob, pas encore logé, paie 4 nuits à 15, pénurie complète (${landlordFirst ? 'bailleur' : 'locataire'} d’abord)`, async () => {
        const world = await leased(landlordFirst, 500, true);
        await close(world.worldId, withPropertyUpkeep);
        expect(await unpaidSince(world)).toBe(false);
        expect(await lodgingPaidBy(world.houses[1]?.houseId ?? '')).toBe(60);
        expect(await laborMarketOf(db, world.cityIds['kalliste'] ?? '')).toMatchObject([
          { employed: 4, unhoused: 4, lodging: 15 },
        ]);
      });
  });
});
