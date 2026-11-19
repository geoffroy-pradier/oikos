import {
  createConfigLoader,
  DEFAULT_LABOR,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl, type Db } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_STEPS } from './close-steps';
import { closeWorld } from './scheduler';
import {
  laborMarketOf,
  laborWorld,
  purseCredits,
  type LaborWorld,
  type LaborWorldSpec,
} from './steps/labor.integration-fixtures';
import { neutralEconomy } from './neutral.integration-fixtures';

// Marché du travail et logement de bout en bout (#258) : la clôture entière, contre Supabase local. Chaque
// test a son monde, à Kallistè ; sans entretien des sites, le dû d'un site est ses salaires et
// l'hébergement de ses non logés.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
/** La configuration initiale, à paramètres économiques neutres : chaque essai règle le tarif qu'il éprouve (#668). */
const initial = neutralEconomy(INITIAL_CONFIG as GameConfig);
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
/**
 * Un thète sur mille travaille. Salaire de base 10 : ×0,8 sans emploi, ×1,2 au plein emploi, ×1,5 sous
 * l'emploi. Hébergement de base 5 : ×1 sans pénurie, ×3 à pénurie complète.
 */
const config: GameConfig = {
  ...initial,
  clock,
  sites: { ...initial.sites, upkeep: { ...initial.sites.upkeep, coefficientBps: 0 } },
  staff: { dailyWageOboles: { kalliste: 10, elaia: 0, ampelos: 0, halos: 0 } },
  labor: {
    workingShareBps: { thetes: 10 },
    wage: { minBps: 8_000, maxBps: 15_000, slopeBps: 4_000 },
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
    steps: CLOSE_STEPS,
  });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Deux champs (8 travailleurs) pour une maison dotée de 1 000 oboles, et `extra` pour le reste du monde. */
const twoFields = (thetes: number, extra: Partial<LaborWorldSpec> = {}) =>
  laborWorld(owner, {
    population: { kalliste: { thetes } },
    ...extra,
    houses: [
      {
        oboles: 1_000,
        sites: [
          { city: 'kalliste', recipe: 'grow_wheat' },
          { city: 'kalliste', recipe: 'grow_wheat' },
        ],
        properties: [
          { city: 'kalliste', size: 'townhouse' },
          { city: 'kalliste', size: 'townhouse' },
        ],
      },
      ...(extra.houses ?? []),
    ],
  });
/** Trésorerie de chaque maison, monnaie des puits des salaires et de l'hébergement, sites à l'arrêt. */
const outcome = async ({ worldId, houses }: LaborWorld) => {
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
  const halted = await sql<{ n: string }>`select count(*) as n from game.sites
    where world_id = ${worldId} and halted_at is not null`.execute(db);
  // Salaires et hébergement vont aux bourses des PNJ (#632) : ce qu'elles ont reçu.
  const { wages, lodging } = await purseCredits(db, worldId);
  return {
    treasuries: houses.map(({ houseId }) => of((row) => row.house_id === houseId)),
    wages,
    lodging,
    halted: Number(halted.rows[0]?.n),
  };
};
/** Ce que la maison lit de ses travailleurs (`my_workforce`), sous son propre compte de joueur. */
const workforceSeenBy = (houseId: string) =>
  owner.transaction().execute(async (trx: Db) => {
    await sql`set local role authenticated`.execute(trx);
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: houseId, role: 'authenticated' })}, true)`.execute(
      trx,
    );
    const { rows } = await sql<{ site_id: string; housed: number; unhoused: number }>`
      select site_id, housed, unhoused from public.my_workforce order by site_id`.execute(trx);
    return rows;
  });

describe('marché du travail et logement à la clôture (#258)', () => {
  it('plein emploi : salaire à ×1,2 ; logée par ses biens, la maison ne paie aucun hébergement', async () => {
    const world = await twoFields(8_000);
    await close(world.worldId);
    expect(await laborMarketOf(db, world.cityIds['kalliste'] ?? '')).toEqual([
      { gameDay: TODAY, supply: 8, employed: 8, unhoused: 0, wage: 12, lodging: 5 },
    ]);
    expect(await outcome(world)).toEqual({
      treasuries: [1_000 - 96],
      wages: 96,
      lodging: 0,
      halted: 0,
    });
  });

  it('population tombée sous l’emploi : aucun site ne s’arrête, le salaire est à sa borne haute', async () => {
    const world = await twoFields(5_000);
    await close(world.worldId);
    expect(await laborMarketOf(db, world.cityIds['kalliste'] ?? '')).toEqual([
      { gameDay: TODAY, supply: 5, employed: 8, unhoused: 0, wage: 15, lodging: 5 },
    ]);
    expect(await outcome(world)).toEqual({
      treasuries: [1_000 - 120],
      wages: 120,
      lodging: 0,
      halted: 0,
    });
  });

  it('une maison logée par un bail, une maison sans logement : ce qu’elles lisent est ce qu’elles paient', async () => {
    // Alice loue l'une de ses deux maisons de ville à Bob ; Chloé n'a pas de logement. 20 travailleurs,
    // 12 thètes offerts : salaire ×1,5 ; non logés : 4 d'Alice et 4 de Chloé, soit 8 sur 16, ×2 → 10.
    const world = await twoFields(12_000, {
      houses: [
        { oboles: 1_000, sites: [{ city: 'kalliste', recipe: 'grow_olives' }] },
        { oboles: 1_000, sites: [{ city: 'kalliste', recipe: 'grow_grapes' }] },
      ],
      leases: [{ landlord: 0, property: 1, tenant: 1 }],
    });
    const [alice, bob, chloe] = world.houses;
    const seenBefore = await workforceSeenBy(alice?.houseId ?? '');
    expect(seenBefore.map((site) => site.unhoused).sort()).toEqual([0, 4]);
    expect(await workforceSeenBy(bob?.houseId ?? '')).toEqual([
      { site_id: bob?.siteIds[0], housed: 4, unhoused: 0 },
    ]);
    expect(await workforceSeenBy(chloe?.houseId ?? '')).toEqual([
      { site_id: chloe?.siteIds[0], housed: 0, unhoused: 4 },
    ]);
    await close(world.worldId);
    expect(await laborMarketOf(db, world.cityIds['kalliste'] ?? '')).toEqual([
      { gameDay: TODAY, supply: 12, employed: 16, unhoused: 8, wage: 15, lodging: 10 },
    ]);
    // Alice : 8 × 15 de salaires, 4 × 10 d'hébergement. Bob : 4 × 15 ; son bail, signé après l'instant de
    // la clôture, ne doit pas encore de loyer, mais le loge déjà. Chloé : 4 × 15 et 4 × 10.
    expect(await outcome(world)).toEqual({
      treasuries: [1_000 - 120 - 40, 1_000 - 60, 1_000 - 60 - 40],
      wages: 240,
      lodging: 80,
      halted: 0,
    });
  });

  it('configuration neutre : offre sans limite, salaire de base, ni hébergement ni écriture à part', async () => {
    const world = await laborWorld(owner, {
      houses: [{ oboles: 1_000, sites: [{ city: 'kalliste', recipe: 'grow_wheat' }] }],
    });
    await close(world.worldId, { ...config, labor: structuredClone(DEFAULT_LABOR) });
    expect(await laborMarketOf(db, world.cityIds['kalliste'] ?? '')).toEqual([
      { gameDay: TODAY, supply: null, employed: 4, unhoused: 4, wage: 10, lodging: 0 },
    ]);
    expect(await outcome(world)).toEqual({ treasuries: [960], wages: 40, lodging: 0, halted: 0 });
    const { rows } = await sql<{ n: string }>`select count(*) as n from game.ledger_entries
      where world_id = ${world.worldId} and kind like 'lodging.%'`.execute(db);
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
