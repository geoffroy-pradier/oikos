import {
  createConfigLoader,
  DEFAULT_NPC_PUBLIC_INCOME_BPS,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt, tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorld } from '../scheduler';
import { runTick } from '../tick';
import { laborWorld } from './labor.integration-fixtures';
import { npcDemand } from './npc-demand';
import { npcPublicIncome } from './npc-public-income';

// Revenu public des PNJ à la clôture (#632), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
/** Multiplicateur ×1 partout, celui de la configuration initiale. */
const CITY_BPS = Object.fromEntries(initial.cities.map((city) => [city.id, 10_000]));
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
/**
 * Configuration initiale, revenu public des thètes à `bps` (10 % : 1 000 ; absent si `bps` l'est : celui d'une
 * version publiée avant le paramètre), des autres classes nul. `cities` : multiplicateur de chaque cité (#657),
 * absent pour une cité qui n'y figure pas (celui d'une version publiée avant lui).
 */
const settings = (bps?: number, cities: Record<string, number> = CITY_BPS) => ({
  at: async () => ({
    ...loaded,
    config: {
      ...initial,
      clock,
      cities: initial.cities.map(({ npcPublicIncomeBps: _, ...city }) => {
        const cityBps = cities[city.id];
        return cityBps === undefined ? city : { ...city, npcPublicIncomeBps: cityBps };
      }),
      npcClasses: initial.npcClasses.map(({ publicIncomeBps: _, ...npcClass }) =>
        npcClass.id !== 'thetes'
          ? { ...npcClass, publicIncomeBps: 0 }
          : bps === undefined
            ? npcClass
            : { ...npcClass, publicIncomeBps: bps },
      ),
    },
  }),
});
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, bps?: number, day = TODAY, cities = CITY_BPS) =>
  closeWorld(db, {
    worldId,
    now: dailyCloseAt(day, clock),
    config: settings(bps, cities),
    steps: [npcPublicIncome],
  });
/** Tick de demande des PNJ de rang `rank` après l'ouverture du jour de jeu `day`, joué à son heure. */
const tick = (worldId: string, bps?: number, rank = 1, day = TODAY, cities = CITY_BPS) => {
  const index = tickIndexAt(dailyCloseAt(day, clock), clock.tickMinutes) + rank;
  const scheduledAt = tickStart(index, clock.tickMinutes);
  return runTick(db, {
    worldId,
    index,
    scheduledAt,
    config: { ...settings(bps, cities), byId: async () => loaded },
    steps: [npcDemand],
    now: () => new Date(scheduledAt.getTime() + 1000),
  });
};
/** Solde de chaque bourse du monde, par slug de cité, et du robinet ; écritures du revenu public. */
async function ledgerOf(world: { worldId: string; cityIds: Record<string, string> }) {
  const slugOf = new Map(Object.entries(world.cityIds).map(([slug, id]) => [id, slug]));
  const purses = await sql<{ city_id: string; balance: string }>`select city_id, balance
    from game.npc_purses() where world_id = ${world.worldId}`.execute(db);
  const faucet = await sql<{ balance: string }>`select balance from game.accounts
    where world_id = ${world.worldId} and system_key = 'faucet_npc_public_income'`.execute(db);
  const entries = await sql<{
    meta: { cityId: string; gameDay: number };
  }>`select meta from game.ledger_entries
    where world_id = ${world.worldId} and kind = 'npc.public_income'`.execute(db);
  return {
    purses: Object.fromEntries(
      purses.rows.map((row) => [slugOf.get(row.city_id), Number(row.balance)]),
    ),
    faucet: Number(faucet.rows[0]?.balance),
    entries: entries.rows
      .map(({ meta }) => [slugOf.get(meta.cityId) ?? '', meta.gameDay] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  };
}
const THETES = initial.npcClasses.find((npcClass) => npcClass.id === 'thetes');

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

describe('revenu public des PNJ (#632)', () => {
  it('une écriture par cité de la configuration, sur la population du jour ; une seule fois par jour de jeu', async () => {
    // Kallistè : 5 000 thètes (état du monde) ; Elaia : 6 000, ceux de la configuration ; Théra hors configuration.
    const world = await laborWorld(owner, {
      cities: ['kalliste', 'elaia', 'thera'],
      population: { kalliste: { thetes: 5_000 } },
      houses: [],
    });
    expect(THETES?.incomePerThousand).toBe(70);
    // 70 oboles par tick pour 1 000 thètes × 144 ticks × 10 % : 1 008 pour 1 000 thètes par jour.
    expect(await close(world.worldId, 1_000)).toEqual([TODAY]);
    const after = await ledgerOf(world);
    expect(after).toEqual({
      purses: { kalliste: 5_040, elaia: 6_048, thera: 0 },
      faucet: -(5_040 + 6_048),
      entries: [
        ['elaia', TODAY],
        ['kalliste', TODAY],
      ],
    });
    // Rejouée, la clôture du jour n'écrit rien de plus.
    expect(await close(world.worldId, 1_000)).toEqual([]);
    expect(await ledgerOf(world)).toEqual(after);
  });

  it('le tick verse le revenu du jour s’il ne l’a pas été, sans attendre la clôture ; une fois par cité et par jour, même en concurrence', async () => {
    const expected = {
      purses: { kalliste: 5_040, elaia: 6_048 },
      faucet: -(5_040 + 6_048),
      entries: [
        ['elaia', TODAY],
        ['kalliste', TODAY],
      ],
    };
    const spec = {
      cities: ['kalliste', 'elaia'],
      population: { kalliste: { thetes: 5_000 } },
      houses: [],
    };
    // Monde déjà clos ce jour-là, ou déployé après la clôture : le premier tick du jour verse, la clôture rejouée et
    // les ticks suivants ne versent rien de plus.
    const late = await laborWorld(owner, spec);
    await tick(late.worldId, 1_000);
    expect(await ledgerOf(late)).toEqual(expected);
    await tick(late.worldId, 1_000, 2);
    expect(await close(late.worldId, 1_000)).toEqual([TODAY]);
    expect(await ledgerOf(late)).toEqual(expected);
    // Clôture d'abord : le tick ne verse rien de plus.
    const early = await laborWorld(owner, spec);
    await close(early.worldId, 1_000);
    await tick(early.worldId, 1_000);
    expect(await ledgerOf(early)).toEqual(expected);
    // Clôture et ticks en même temps : un seul versement par cité.
    const racing = await laborWorld(owner, spec);
    await Promise.all([
      close(racing.worldId, 1_000),
      tick(racing.worldId, 1_000),
      tick(racing.worldId, 1_000, 2),
    ]);
    expect(await ledgerOf(racing)).toEqual(expected);
  });

  it('part absente : celle d’une version publiée avant le paramètre ; part nulle : rien, sans écriture', async () => {
    // 6 000 thètes de la configuration à Kallistè, 70 oboles par tick pour 1 000, 144 ticks.
    const fallback = Math.floor((70 * 6_000 * DEFAULT_NPC_PUBLIC_INCOME_BPS * 144) / 10_000_000);
    for (const [bps, oboles] of [
      [undefined, fallback],
      [0, 0],
    ] as const) {
      const world = await laborWorld(owner, { cities: ['kalliste'], houses: [] });
      expect(await close(world.worldId, bps)).toEqual([TODAY]);
      expect(await ledgerOf(world)).toEqual({
        purses: { kalliste: oboles },
        faucet: 0 - oboles,
        entries: oboles > 0 ? [['kalliste', TODAY]] : [],
      });
    }
  });

  it('multiplicateur de chaque cité, à la clôture comme au premier tick du jour, arrondi une fois (#657)', async () => {
    // 1 008 oboles pour 1 000 thètes à 10 %. Kallistè : 999 thètes, 1 006,992 à ×1 ; à ×1,2345, 1 243,12 : 1 243,
    // là où deux arrondis (1 006 × 1,2345 = 1 241,9) donneraient 1 241. Elaia 6 000 à ×0, Ampélos 6 000 à ×2,
    // Halos 6 000 sans multiplicateur (×1, version publiée avant lui).
    const cities = { kalliste: 12_345, elaia: 0, ampelos: 20_000 };
    const expected = {
      purses: { kalliste: 1_243, elaia: 0, ampelos: 12_096, halos: 6_048 },
      faucet: -(1_243 + 12_096 + 6_048),
      entries: [
        ['ampelos', TODAY],
        ['halos', TODAY],
        ['kalliste', TODAY],
      ],
    };
    const spec = {
      cities: ['kalliste', 'elaia', 'ampelos', 'halos'],
      population: { kalliste: { thetes: 999 } },
      houses: [],
    };
    const closed = await laborWorld(owner, spec);
    expect(await close(closed.worldId, 1_000, TODAY, cities)).toEqual([TODAY]);
    expect(await ledgerOf(closed)).toEqual(expected);
    const ticked = await laborWorld(owner, spec);
    await tick(ticked.worldId, 1_000, 1, TODAY, cities);
    expect(await ledgerOf(ticked)).toEqual(expected);
  });
});
