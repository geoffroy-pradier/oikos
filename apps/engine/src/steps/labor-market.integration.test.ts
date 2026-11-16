import {
  createConfigLoader,
  DEFAULT_LABOR,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWorld } from '../scheduler';
import { laborMarket } from './labor-market';
import { laborMarketOf, laborWorld } from './labor.integration-fixtures';

// Marché du travail du jour à la clôture (#258), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
/**
 * Un thète sur mille travaille ; salaire de base 10 à Kallistè, de ×0,8 à ×1,5 (pente ×0,4 au plein
 * emploi) ; hébergement de base 5, de ×1 à ×3 (pente ×2 à pénurie complète).
 */
const labor = {
  workingShareBps: { thetes: 10 },
  wage: { minBps: 8_000, maxBps: 15_000, slopeBps: 4_000 },
  lodging: { baseOboles: 5, minBps: 10_000, maxBps: 30_000, slopeBps: 20_000 },
};
const staff = { dailyWageOboles: { kalliste: 10, elaia: 6, ampelos: 0, halos: 0 } };
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const settings = (patch: Partial<GameConfig>) => ({
  at: async () => ({ ...loaded, config: { ...initial, clock, staff, labor, ...patch } }),
});
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, patch: Partial<GameConfig> = {}, day = TODAY) =>
  closeWorld(db, {
    worldId,
    now: dailyCloseAt(day, clock),
    config: settings(patch),
    steps: [laborMarket],
  });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

describe('marché du travail du jour (#258)', () => {
  it('offre, emploi, salaire et hébergement de chaque cité, une seule fois par jour de jeu', async () => {
    // Kallistè : 5 000 thètes, donc 5 travailleurs offerts. Alice y a deux champs (8 travailleurs) et une
    // maison de ville (4 logements) ; Bob un atelier de farine (2), sans logement. Elaia : un pressoir de
    // Bob (2), qu'une maison de ville d'Alice à Elaia ne loge pas ; sa population n'est pas encore née.
    const world = await laborWorld(owner, {
      cities: ['kalliste', 'elaia'],
      population: { kalliste: { thetes: 5_000, zeugitai: 9_000 } },
      houses: [
        {
          oboles: 0,
          sites: [
            { city: 'kalliste', recipe: 'grow_wheat' },
            { city: 'kalliste', recipe: 'grow_wheat' },
          ],
          properties: [
            { city: 'kalliste', size: 'townhouse' },
            { city: 'elaia', size: 'townhouse' },
          ],
        },
        {
          oboles: 0,
          sites: [
            { city: 'kalliste', recipe: 'mill_flour' },
            { city: 'elaia', recipe: 'press_oil' },
          ],
        },
      ],
    });
    expect(await close(world.worldId)).toEqual([TODAY]);
    // Kallistè : 10 employés pour 5 offerts, la borne haute (10 × 1,5) ; 6 non logés sur 10, ×2,2 → 11.
    expect(await laborMarketOf(db, world.cityIds['kalliste'] ?? '')).toEqual([
      { gameDay: TODAY, supply: 5, employed: 10, unhoused: 6, wage: 15, lodging: 11 },
    ]);
    // Elaia : population de la configuration (6 000 thètes, 6 offerts), 2 employés : 33 %, ×0,93 → 5,6 → 6.
    // Les deux non logés font la pénurie complète : ×3.
    expect(await laborMarketOf(db, world.cityIds['elaia'] ?? '')).toEqual([
      { gameDay: TODAY, supply: 6, employed: 2, unhoused: 2, wage: 6, lodging: 15 },
    ]);
    // Rejouée, la clôture du jour ne refixe rien.
    expect(await close(world.worldId)).toEqual([]);
    expect(await laborMarketOf(db, world.cityIds['kalliste'] ?? '')).toHaveLength(1);
  });

  it('un bien loué loge son locataire, pas son propriétaire ; un bien impayé ou trop usé ne loge personne', async () => {
    const world = await laborWorld(owner, {
      houses: [
        {
          oboles: 0,
          sites: [{ city: 'kalliste', recipe: 'grow_wheat' }],
          properties: [
            { city: 'kalliste', size: 'townhouse' },
            { city: 'kalliste', size: 'tenement', unpaid: true },
            { city: 'kalliste', size: 'tenement', condition: 2_999 },
          ],
        },
        { oboles: 0, sites: [{ city: 'kalliste', recipe: 'grow_olives' }] },
      ],
      leases: [{ landlord: 0, property: 0, tenant: 1 }],
    });
    await close(world.worldId);
    // Les 4 logements de la maison de ville vont à Bob, locataire ; Alice n'a plus que des biens qui ne
    // logent personne (entretien impayé, état sous le seuil de 3 000). 4 non logés sur 8 : ×2.
    expect(await laborMarketOf(db, world.cityIds['kalliste'] ?? '')).toEqual([
      { gameDay: TODAY, supply: 6, employed: 8, unhoused: 4, wage: 15, lodging: 10 },
    ]);
  });

  it('configuration neutre : offre sans limite, salaire de base, hébergement nul', async () => {
    const world = await laborWorld(owner, {
      houses: [{ oboles: 0, sites: [{ city: 'kalliste', recipe: 'grow_wheat' }] }],
    });
    await close(world.worldId, { labor: structuredClone(DEFAULT_LABOR) });
    expect(await laborMarketOf(db, world.cityIds['kalliste'] ?? '')).toEqual([
      { gameDay: TODAY, supply: null, employed: 4, unhoused: 4, wage: 10, lodging: 0 },
    ]);
  });
});
