import { createConfigLoader, ensureInitialConfig, INITIAL_CONFIG } from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE, chronicleWorld, DAY, FINISHED, initial } from './chronicle.integration-fixtures';
import { readChronicleDay } from './day';

// Journée racontée par la chronique (#271), contre Supabase local.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
let versionId: string;
let otherVersionId: string;
const closeOf = (version: string) => ({
  game_day: DAY,
  close_at: CLOSE,
  finished_at: FINISHED,
  config_version_id: version,
  summary: {},
});

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  versionId = (await createConfigLoader(db).at(new Date())).id;
  // Une autre version, jamais activée : celle qu'aurait lue la clôture précédente.
  const other = await owner
    .insertInto('config.versions' as never)
    .values({ payload: JSON.stringify({ note: 'chronique' }) } as never)
    .returning('id' as never)
    .executeTakeFirstOrThrow();
  otherVersionId = (other as { id: string }).id;
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/**
 * Événements du monde déjà planifiés, posés garde levée : une tempête qui commence à la clôture du jour, une
 * sécheresse le lendemain (pas encore commencée pour cette chronique).
 */
async function planEvents(worldId: string, kalliste: string, elaia: string) {
  await owner.transaction().execute(async (trx) => {
    await sql`alter table game.world_events disable trigger world_events_guard`.execute(trx);
    const fixed = { world_id: worldId, city_id: kalliste, good_id: null, magnitude_bps: 1000 };
    const event = (model: 'storm' | 'drought', start: number, other_city_id: string | null) => ({
      ...{ ...fixed, model, other_city_id, planned_day: DAY - 1, seed: 'ab'.repeat(32) },
      ...{ start_day: start, end_day: start + 2, starts_at: dailyCloseAt(start, initial.clock) },
      ends_at: dailyCloseAt(start + 2, initial.clock),
    });
    await trx
      .insertInto('game.world_events')
      .values([event('storm', DAY, elaia), event('drought', DAY + 1, null)])
      .execute();
    // Référence à la clôture contrôlée aussitôt : pas d'ALTER avec un contrôle en attente.
    await sql`set constraints game.world_events_played_close immediate`.execute(trx);
    await sql`alter table game.world_events enable trigger world_events_guard`.execute(trx);
  });
}

describe('journée d’une chronique (#271)', () => {
  it('des fins de clôture à la suivante, résultats de celle-ci compris ; ni avant, ni après, ni un autre monde', async () => {
    const { worldId, cities, ids } = await chronicleWorld(owner, versionId);
    await planEvents(worldId, ids.kalliste, ids.elaia);
    const day = await readChronicleDay(db, worldId, closeOf(versionId), cities, initial.clock);
    // Même version que la clôture précédente : aucune configuration annoncée.
    expect(day.events).toEqual([
      { type: 'trade', cityId: 'kalliste', goodId: 'wheat', price: 6, quantity: 10 },
      { type: 'trade', cityId: 'kalliste', goodId: 'wheat', price: 7, quantity: 5 },
      { type: 'election', cityId: 'kalliste', houseName: '', votes: 3 },
      { type: 'arrival', cityId: 'kalliste', fromCityId: 'elaia' },
      { type: 'election', cityId: 'kalliste', houseName: 'Alcméonides', votes: 3 },
      {
        type: 'decree',
        cityId: 'elaia',
        model: 'festival',
        outcome: 'adopted',
        votesFor: 4,
        votesAgainst: 1,
      },
    ]);
    // La tempête commence à cette clôture ; la sécheresse, le lendemain, n'a pas commencé.
    expect(day.worldEvents).toEqual([
      { model: 'storm', cityId: 'kalliste', otherCityId: 'elaia', goodId: null },
    ]);
    expect(day.population('kalliste')).toBeNull();
  });

  it('la population vient du journal de la clôture, sommée par cité ; un journal illisible n’en dit rien', async () => {
    const { worldId, cities } = await chronicleWorld(owner, versionId);
    const summary = {
      npcPopulation: {
        classes: [
          { city: 'kalliste', classId: 'thetes', before: 1000, after: 990 },
          { city: 'kalliste', classId: 'hippeis', before: 203, after: 201 },
          { city: 'elaia', classId: 'thetes', before: 5, after: 6 },
        ],
      },
    };
    const close = { ...closeOf(versionId), summary };
    const day = await readChronicleDay(db, worldId, close, cities, initial.clock);
    expect(day.population('kalliste')).toEqual({ before: 1203, after: 1191 });
    expect(day.population('elaia')).toEqual({ before: 5, after: 6 });
    expect(day.population('halos')).toBeNull();
    for (const row of [{ city: 'kalliste' }, { city: 'kalliste', before: -1, after: 3 }]) {
      const broken = { ...close, summary: { npcPopulation: { classes: [row] } } };
      const read = await readChronicleDay(db, worldId, broken, cities, initial.clock);
      expect([read.population('kalliste'), read.population('elaia')]).toEqual([null, null]);
    }
  });

  it('sans clôture précédente, la journée qui commence à la clôture de la veille', async () => {
    const { worldId, cities } = await chronicleWorld(owner, versionId, null);
    const day = await readChronicleDay(db, worldId, closeOf(otherVersionId), cities, initial.clock);
    // L'échange d'avant la fin de la clôture d'hier en est, faute de clôture qui l'ait raconté.
    const trades = day.events.filter(
      (event) => event.type === 'trade' && event.cityId === 'kalliste',
    );
    expect(trades).toHaveLength(3);
    // Sans clôture précédente, rien à comparer : aucune configuration annoncée.
    expect(day.events.some((event) => event.type === 'configScheduled')).toBe(false);
  });

  it('une version lue par la clôture qui n’est plus celle de la précédente est annoncée', async () => {
    const { worldId, cities } = await chronicleWorld(owner, versionId, otherVersionId);
    const day = await readChronicleDay(db, worldId, closeOf(versionId), cities, initial.clock);
    expect(day.events).toContainEqual({ type: 'configScheduled', activateAt: CLOSE.getTime() });
  });
});
