import {
  createConfigLoader,
  DEFAULT_NPC_PUBLIC_INCOME_BPS,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorld } from '../scheduler';
import { laborWorld } from './labor.integration-fixtures';
import { npcPublicIncome } from './npc-public-income';

// Revenu public des PNJ à la clôture (#632), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
/**
 * Configuration initiale, revenu public des thètes à `bps` (10 % : 1 000 ; absent si `bps` l'est : celui d'une
 * version publiée avant le paramètre), des autres classes nul.
 */
const settings = (bps?: number) => ({
  at: async () => ({
    ...loaded,
    config: {
      ...initial,
      clock,
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
const close = (worldId: string, bps?: number, day = TODAY) =>
  closeWorld(db, {
    worldId,
    now: dailyCloseAt(day, clock),
    config: settings(bps),
    steps: [npcPublicIncome],
  });
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
});
