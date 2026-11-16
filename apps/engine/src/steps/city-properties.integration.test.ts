import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { tickIndexAt, tickStart } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTick, type TickRequest } from '../tick';
import { cityProperties } from './city-properties';

// Création du parc de logements par le tick (4.5), contre Supabase local. Chaque test a son monde.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
let loader: ReturnType<typeof createConfigLoader>;
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
let first: number;

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loader = createConfigLoader(db);
  loaded = await loader.at(new Date());
  first = tickIndexAt(new Date(), loaded.config.clock.tickMinutes) - 100;
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** La configuration initiale, avec le parc donné (tailles initiales). */
const withCounts = (countsByCity: GameConfig['properties']['countsByCity']): GameConfig => ({
  ...initial,
  properties: { ...initial.properties, countsByCity },
});
const request = (worldId: string, config: GameConfig, index: number): TickRequest => {
  const scheduledAt = tickStart(index, loaded.config.clock.tickMinutes);
  return {
    worldId,
    index,
    scheduledAt,
    config: { at: async () => ({ ...loaded, config }), byId: loader.byId },
    steps: [cityProperties],
    now: () => new Date(scheduledAt.getTime() + 1000),
  };
};

/** Un monde à deux cités de la configuration et une cité qu'elle ne connaît pas. */
async function newWorld() {
  const worldId = randomUUID();
  await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`n-${worldId.slice(0, 12)}`}, 'Test'))
    insert into game.cities (world_id, slug, name) values
      (${worldId}, 'kalliste', 'Kallistè'), (${worldId}, 'elaia', 'Elaia'), (${worldId}, 'atlantis', 'Atlantis')`.execute(
    owner,
  );
  return worldId;
}
/** Le parc du monde : cité, taille, numéros, et ce que tout bien neuf doit être. */
const park = async (worldId: string) =>
  (
    await sql<{ city: string; size_id: string; lots: number[]; pristine: boolean }>`
      select c.slug as city, p.size_id, array_agg(p.lot order by p.lot) as lots,
             bool_and(p.owner_house_id is null and p.condition = 10000 and p.worn_day is null) as pristine
      from game.properties p join game.cities c on c.id = p.city_id
      where p.world_id = ${worldId} group by c.slug, p.size_id order by c.slug, p.size_id`.execute(
      db,
    )
  ).rows;

describe('cityProperties', () => {
  it('le premier tick crée le parc de chaque cité connue, neuf et à la cité ; le suivant ne crée rien', async () => {
    const worldId = await newWorld();
    const config = withCounts({
      kalliste: { townhouse: 3, tenement: 1 },
      elaia: { townhouse: 2, tenement: 0 },
    });
    const played = await runTick(db, request(worldId, config, first));
    expect(played.summary).toEqual({
      cityProperties: {
        built: [
          { city: 'elaia', sizeId: 'townhouse', properties: 2 },
          { city: 'kalliste', sizeId: 'tenement', properties: 1 },
          { city: 'kalliste', sizeId: 'townhouse', properties: 3 },
        ],
      },
    });
    const expected = [
      { city: 'elaia', size_id: 'townhouse', lots: [1, 2], pristine: true },
      { city: 'kalliste', size_id: 'tenement', lots: [1], pristine: true },
      { city: 'kalliste', size_id: 'townhouse', lots: [1, 2, 3], pristine: true },
    ];
    expect(await park(worldId)).toEqual(expected);
    // Le tick rejoué n'est pas rejoué ; le tick suivant trouve le parc complet.
    expect((await runTick(db, request(worldId, config, first))).status).toBe('skipped');
    const next = await runTick(db, request(worldId, config, first + 1));
    expect(next.summary).toEqual({ cityProperties: { built: [] } });
    expect(await park(worldId)).toEqual(expected);
  });

  it('un nombre relevé complète le parc ; baissé, ou une taille retirée, ne retire rien', async () => {
    const worldId = await newWorld();
    await runTick(db, request(worldId, withCounts({ kalliste: { townhouse: 2 } }), first));
    const raised = await runTick(
      db,
      request(worldId, withCounts({ kalliste: { townhouse: 4 } }), first + 1),
    );
    expect(raised.summary).toEqual({
      cityProperties: { built: [{ city: 'kalliste', sizeId: 'townhouse', properties: 2 }] },
    });
    const lowered = withCounts({ kalliste: { townhouse: 1 } });
    await runTick(db, request(worldId, lowered, first + 2));
    await runTick(
      db,
      request(worldId, { ...lowered, properties: { sizes: [], countsByCity: {} } }, first + 3),
    );
    expect(await park(worldId)).toEqual([
      { city: 'kalliste', size_id: 'townhouse', lots: [1, 2, 3, 4], pristine: true },
    ]);
  });

  it('deux ticks concurrents du même monde ne créent chaque bien qu’une fois', async () => {
    const worldId = await newWorld();
    const config = withCounts({ kalliste: { townhouse: 12, tenement: 4 } });
    const outcomes = await Promise.all(
      [first, first + 1, first + 2].map((index) => runTick(db, request(worldId, config, index))),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['done', 'done', 'done']);
    expect(await park(worldId)).toEqual([
      { city: 'kalliste', size_id: 'tenement', lots: [1, 2, 3, 4], pristine: true },
      {
        city: 'kalliste',
        size_id: 'townhouse',
        lots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        pristine: true,
      },
    ]);
  });

  it('une version publiée avant l’immobilier ne crée aucun bien', async () => {
    const worldId = await newWorld();
    const older = { ...initial, properties: { sizes: [], countsByCity: {} } };
    expect((await runTick(db, request(worldId, older, first))).summary).toEqual({
      cityProperties: { built: [] },
    });
    expect(await park(worldId)).toEqual([]);
  });
});
