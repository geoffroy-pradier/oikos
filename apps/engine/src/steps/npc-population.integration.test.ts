import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  type GameConfig,
} from '@oikos/config';
import { createDb, serviceRoleUrl, type Db } from '@oikos/db';
import { dailyCloseAt, gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyClose } from '../close';
import { closeWorld } from '../scheduler';
import { npcPopulation } from './npc-population';

// Population des PNJ à la clôture, contre Supabase local. Chaque test a son monde ; l'état et la mesure
// sont posés par le rôle de service, comme le fait le tick de demande.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
/** Seuil 90 % ; +1 % par jour à 100 %, −2 % à 0 % ; entre la moitié et le double de la population initiale. */
const populationDynamics = {
  vitalCoverageThresholdBps: 9_000,
  growthBps: 100,
  emigrationBps: 200,
  minShareBps: 5_000,
  maxShareBps: 20_000,
};
const START = { thetes: 6_000, zeugitai: 2_500, hippeis: 1_200, pentakosiomedimnoi: 300 };
const cities = [{ id: 'kalliste', population: START }];
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const config = { ...(INITIAL_CONFIG as GameConfig), clock, populationDynamics, cities };
const TODAY = gameDayAt(new Date(), clock);
const close = (worldId: string, day = TODAY) =>
  closeWorld(db, {
    worldId,
    now: dailyCloseAt(day, clock),
    config: { at: async () => ({ ...loaded, config }) },
    steps: [npcPopulation],
  });
/** La même clôture sans le raccourci de `closeWorld` : `runDailyClose` décide seul, sous son verrou. */
const replay = (worldId: string, gameDay: number) =>
  runDailyClose(db, {
    worldId,
    gameDay,
    closeAt: dailyCloseAt(gameDay, clock),
    config: { at: async () => ({ ...loaded, config }) },
    steps: [npcPopulation],
    now: new Date(),
  });
/** L'étape seule, sous le rôle de service, hors de `runDailyClose` : rien n'enregistre la clôture. */
const stepAlone = (worldId: string, gameDay: number) =>
  db
    .transaction()
    .execute((trx) =>
      npcPopulation.run({ trx, worldId, gameDay, closeAt: dailyCloseAt(gameDay, clock), config }),
    );

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Un monde et sa cité, avec la population `{ classe: habitants }` posée comme à la naissance de l'état. */
async function newCity(population: Record<string, number>, slug = 'kalliste') {
  const [worldId, cityId] = [randomUUID(), randomUUID()];
  await sql`with world as (insert into game.worlds (id, slug, name) values (${worldId}, ${`p-${worldId.slice(0, 12)}`}, 'Test'))
    insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, ${slug}, 'Agora')`.execute(
    owner,
  );
  await db
    .insertInto('game.npc_population')
    .values(
      Object.entries(population).map(([class_id, people]) => ({
        world_id: worldId,
        city_id: cityId,
        class_id,
        population: people,
      })),
    )
    .execute();
  return { worldId, cityId };
}
type City = Awaited<ReturnType<typeof newCity>>;
/** Mesure d'un jour de jeu : `{ classe: [servi, demandé] }`. */
const measure = ({ worldId, cityId }: City, day: number, units: Record<string, [number, number]>) =>
  db
    .insertInto('game.npc_vital_coverage')
    .values(
      Object.entries(units).map(([class_id, [served, demanded]]) => ({
        world_id: worldId,
        city_id: cityId,
        class_id,
        game_day: day,
        served,
        demanded,
      })),
    )
    .execute();
/** État de la cité : `{ classe: [habitants, dernière clôture, couverture retenue] }`. */
const stateOf = async ({ cityId }: City) =>
  Object.fromEntries(
    (
      await db.selectFrom('game.npc_population').selectAll().where('city_id', '=', cityId).execute()
    ).map((row) => [row.class_id, [row.population, row.closed_day, row.coverage_bps]]),
  );
const summaryOf = async ({ worldId }: City, day: number) =>
  (
    await db
      .selectFrom('game.daily_closes')
      .select('summary')
      .where('world_id', '=', worldId)
      .where('game_day', '=', day)
      .executeTakeFirstOrThrow()
  ).summary;

describe('population des PNJ à la clôture quotidienne', () => {
  it('la couverture de la veille fait croître ou émigrer chaque classe, une seule fois par jour de jeu', async () => {
    const city = await newCity({ ...START, metoikoi: 800 });
    const elsewhere = await newCity({ thetes: 6_000 }, 'delos');
    // Thètes servis en entier, zeugites à 45 %, cavaliers exactement au seuil ; rien de mesuré pour la
    // quatrième classe. Les métèques ne sont plus dans la configuration, Délos n'y a jamais été.
    const yesterday = { thetes: [100, 100], zeugitai: [45, 100], hippeis: [90, 100] };
    await measure(city, TODAY - 1, { ...yesterday, metoikoi: [0, 10] } as never);
    await measure(elsewhere, TODAY - 1, { thetes: [0, 10] });
    // La mesure du jour en cours, et celle de l'avant-veille, ne comptent pas pour cette clôture.
    await measure(city, TODAY, { thetes: [0, 100], pentakosiomedimnoi: [0, 100] });
    await measure(city, TODAY - 2, { pentakosiomedimnoi: [0, 100] });

    // Trois moteurs demandent la clôture à la fois : un seul la joue.
    const engines = await Promise.all([1, 2, 3].map(() => close(city.worldId)));
    expect(engines.flat()).toEqual([TODAY]);
    // +1 % de 6 000 ; −2 % × (45 points manquants sur 90) = −1 % de 2 500 ; au seuil, rien ne bouge.
    const after = {
      thetes: [6_060, TODAY, 10_000],
      zeugitai: [2_475, TODAY, 4_500],
      hippeis: [1_200, TODAY, 9_000],
      pentakosiomedimnoi: [300, null, null],
      metoikoi: [800, null, null],
    };
    expect(await stateOf(city)).toEqual(after);
    expect(await summaryOf(city, TODAY)).toEqual({
      npcPopulation: {
        classes: [
          { city: 'kalliste', classId: 'hippeis', coverageBps: 9_000, before: 1_200, after: 1_200 },
          { city: 'kalliste', classId: 'thetes', coverageBps: 10_000, before: 6_000, after: 6_060 },
          {
            city: 'kalliste',
            classId: 'zeugitai',
            coverageBps: 4_500,
            before: 2_500,
            after: 2_475,
          },
        ],
      },
    });
    // Rejouée, ou demandée pour la veille par un moteur en retard : `runDailyClose` relit sous verrou
    // la dernière clôture du monde et ne joue rien.
    expect(await close(city.worldId)).toEqual([]);
    for (const day of [TODAY, TODAY - 1])
      expect(await replay(city.worldId, day)).toMatchObject({ status: 'skipped' });
    // L'étape rejouée sans cette protection : la base refuse une seconde évolution pour le même jour,
    // et, pour un jour dont aucune transaction n'enregistre la clôture, refuse à la validation.
    await expect(stepAlone(city.worldId, TODAY)).rejects.toThrow(/once per game day/);
    await expect(stepAlone(city.worldId, TODAY + 1)).rejects.toMatchObject({
      constraint: 'npc_population_played_close',
    });
    expect(await stateOf(city)).toEqual(after);
    expect(await close(elsewhere.worldId)).toEqual([TODAY]);
    expect(await stateOf(elsewhere)).toEqual({ thetes: [6_000, null, null] });
    expect(await summaryOf(elsewhere, TODAY)).toEqual({ npcPopulation: { classes: [] } });
  });

  it('hors de la clôture, rien ne fait évoluer une population, même pendant qu’une clôture se joue', async () => {
    const city = await newCity(START);
    const forge = (trx: Db) =>
      trx
        .updateTable('game.npc_population')
        .set({ population: 48_000, closed_day: TODAY, coverage_bps: 10_000 })
        .where('city_id', '=', city.cityId)
        .where('class_id', '=', 'thetes')
        .execute();
    // Écriture forgée sous le rôle de service, pour le jour dont la clôture va se jouer : la garde de
    // la base tient le verrou des clôtures du monde, la clôture attend donc la fin de la transaction,
    // qui échoue à sa validation faute d'avoir enregistré la clôture elle-même.
    let closing: Promise<number[]> | undefined;
    const forged = db.transaction().execute(async (trx) => {
      await forge(trx);
      closing = close(city.worldId);
      const waiting = new Promise((resolve) => setTimeout(resolve, 300, 'waiting'));
      expect(await Promise.race([closing, waiting])).toBe('waiting');
    });
    await expect(forged).rejects.toMatchObject({ constraint: 'npc_population_played_close' });
    expect(await closing).toEqual([TODAY]);
    // Clôture enregistrée : la même écriture est refusée d'emblée, la classe n'a pas bougé.
    await expect(forge(db)).rejects.toThrow(/before its close is recorded/);
    expect((await stateOf(city))['thetes']).toEqual([6_000, null, null]);
  });

  it('jour après jour : arrondi à l’habitant vers zéro, bornes, besoin nul, jour sans mesure', async () => {
    // Thètes près du plancher (3 000), zeugites servis à 45 %, cavaliers sans besoin vital mesuré,
    // pentacosiomédimnes près du plafond (600).
    const city = await newCity({
      ...START,
      thetes: 3_010,
      zeugitai: 2_520,
      pentakosiomedimnoi: 599,
    });
    const starving = { thetes: [0, 50], zeugitai: [4.5, 10], pentakosiomedimnoi: [7.5, 7.5] };
    await measure(city, TODAY - 3, { ...starving, hippeis: [0, 0] } as never);
    await measure(city, TODAY - 2, starving as never);
    expect(await close(city.worldId, TODAY - 2)).toEqual([TODAY - 2]);
    // −2 % de 3 010 : 2 950, ramené au plancher ; −1 % de 2 520 = −25,2 : −25 ; rien de demandé :
    // couverture complète, +1 % ; +5,99 habitants : +5, soit 604, ramené au plafond.
    expect(await stateOf(city)).toEqual({
      thetes: [3_000, TODAY - 2, 0],
      zeugitai: [2_495, TODAY - 2, 4_500],
      hippeis: [1_212, TODAY - 2, 10_000],
      pentakosiomedimnoi: [600, TODAY - 2, 10_000],
    });
    expect(await close(city.worldId, TODAY - 1)).toEqual([TODAY - 1]);
    // Aux bornes, plus rien ne bouge ; −24,95 habitants : −24 ; les cavaliers, sans mesure ce jour-là,
    // gardent leur dernière clôture.
    expect(await stateOf(city)).toEqual({
      thetes: [3_000, TODAY - 1, 0],
      zeugitai: [2_471, TODAY - 1, 4_500],
      hippeis: [1_212, TODAY - 2, 10_000],
      pentakosiomedimnoi: [600, TODAY - 1, 10_000],
    });
    // Aucun tick n'a rien mesuré la veille (moteur arrêté) : la clôture du jour ne change rien.
    expect(await close(city.worldId)).toEqual([TODAY]);
    expect((await stateOf(city))['thetes']).toEqual([3_000, TODAY - 1, 0]);
    expect(await summaryOf(city, TODAY)).toEqual({ npcPopulation: { classes: [] } });
  });
});
