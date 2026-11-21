import { randomUUID } from 'node:crypto';
import {
  createConfigLoader,
  ensureInitialConfig,
  INITIAL_CONFIG,
  LITURGY_GENRES as CONFIG_GENRES,
  type GameConfig,
} from '@oikos/config';
import { LITURGY_GENRES } from '@oikos/contracts';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { dailyCloseAt, gameDayAt, seasonOfGameDay } from '@oikos/sim';
import { sql, type KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyClose, type CloseStep } from '../close';
import { liturgyAssignment } from './liturgy-assignment';

// Désignation des liturgies (#719), contre Supabase local. Chaque test a son monde, et joue des clôtures passées.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const clock = { tickMinutes: 10, dailyCloseHour: 4, timezone: 'Europe/Paris', seasonDays: 7 };
const at = (day: number) => dailyCloseAt(day, clock);
/** Lundi qui ouvre la saison précédant celle d'aujourd'hui : ses jours sont tous passés. */
const MONDAY = 4 + 7 * (seasonOfGameDay(gameDayAt(new Date(), clock), 7) - 1);
const SEASON = seasonOfGameDay(MONDAY, 7);
type Rules = NonNullable<GameConfig['liturgies']>;
const RULES: Rules = {
  housesPerCity: 2,
  wealthFloor: 1_000,
  dueShareBps: 1_000,
  minDue: 100,
  maxDue: 800,
  dueDays: 3,
  genres: ['festival', 'trierarchy', 'choregia'],
  honorGain: 0,
  charisGain: 0,
  evasionHonorLoss: 0,
};
let loaded: Awaited<ReturnType<ReturnType<typeof createConfigLoader>['at']>>;
const close = (
  worldId: string,
  gameDay: number,
  /** `null` : une version publiée avant les liturgies, sans la section. */
  liturgies: Rules | null = RULES,
  steps: CloseStep[] = [liturgyAssignment],
) =>
  runDailyClose(db, {
    worldId,
    gameDay,
    closeAt: at(gameDay),
    config: {
      at: async () => {
        const config: GameConfig = { ...initial, clock };
        if (liturgies) config.liturgies = liturgies;
        else delete config.liturgies;
        return { ...loaded, config };
      },
    },
    steps,
    now: new Date(),
  });

beforeAll(async () => {
  await ensureInitialConfig(db, INITIAL_CONFIG);
  loaded = await createConfigLoader(db).at(new Date());
});
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

/** Une maison : cité de son foyer (indice, ou aucune), trésorerie, nature, exclusion validée, rang de fondation. */
type House = { city: number | null; grant: number; npc?: boolean; banned?: boolean; age: number };
/**
 * Un monde à deux cités, ses maisons (fondées `age` jours avant la clôture, dotées par le robinet de départ), et la
 * clôture de la veille du lundi enregistrée : la clôture du lundi est la première de sa saison.
 */
async function newWorld(houses: House[]) {
  const worldId = randomUUID();
  const cities = [randomUUID(), randomUUID()];
  // Identifiants croissants avec l'indice : une fortune croissante avec l'indice range alors la plus riche en dernier.
  const ids = houses.map(() => randomUUID()).sort();
  const users = houses.map(() => randomUUID());
  await owner.transaction().execute(async (trx) => {
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`l-${worldId.slice(0, 12)}`}, 'Test')`.execute(
      trx,
    );
    for (const [index, city] of cities.entries())
      await sql`insert into game.cities (id, world_id, slug, name) values (${city}, ${worldId}, ${`c${index}`}, 'Cité')`.execute(
        trx,
      );
    // Une exclusion est proposée par une personne et validée par une autre (15.4).
    const [author, validator] = [randomUUID(), randomUUID()];
    for (const moderator of [author, validator])
      await sql`insert into auth.users (id, email) values (${moderator}, ${`${moderator}@example.test`})`.execute(
        trx,
      );
    for (const [index, house] of houses.entries()) {
      const [id, user] = [ids[index] ?? '', users[index] ?? ''];
      await sql`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`.execute(
        trx,
      );
      await sql`insert into game.houses (id, world_id, user_id, name, blazon, kind, created_at)
        values (${id}, ${worldId}, ${house.npc ? null : user}, ${`Maison ${String.fromCharCode(97 + index)}`}, '{}',
                ${house.npc ? 'npc' : 'player'}, now() - ${house.age} * interval '1 day')`.execute(
        trx,
      );
      if (house.city !== null)
        await sql`insert into game.citizenships (house_id, city_id) values (${id}, ${cities[house.city]})`.execute(
          trx,
        );
      await sql`insert into game.accounts (world_id, kind, house_id) values (${worldId}, 'house', ${id})`.execute(
        trx,
      );
      const { rows } = await sql<{ id: string }>`insert into game.ledger_entries (world_id, kind)
        values (${worldId}, 'house.starting_grant') returning id`.execute(trx);
      await sql`insert into game.ledger_lines (entry_id, account_id, amount)
        select ${rows[0]?.id}, id, case when system_key is null then ${house.grant}::bigint else ${-house.grant}::bigint end
        from game.accounts where (house_id = ${id} and kind = 'house')
          or (world_id = ${worldId} and system_key = 'faucet_starting_grant')`.execute(trx);
      if (house.banned)
        await sql`insert into admin.sanctions (user_id, kind, reason, author_id, validated_by)
          values (${user}, 'ban', 'Fraude', ${author}, ${validator})`.execute(trx);
    }
    await sql`insert into game.daily_closes (world_id, game_day, close_at, config_version_id)
      values (${worldId}, ${MONDAY - 1}, ${at(MONDAY - 1)}, ${loaded.id})`.execute(trx);
  });
  return { worldId, cities, ids, users };
}
const liturgiesOf = async (worldId: string) =>
  (
    await sql<{
      house_id: string;
      city_id: string;
      season: number;
      genre: string;
      due: string;
      designated_day: number;
      due_day: number;
      due_at: Date;
      status: string;
    }>`select house_id, city_id, season, genre, due::text, designated_day, due_day, due_at, status
      from game.liturgies where world_id = ${worldId} order by city_id, due desc, house_id`.execute(
      db,
    )
  ).rows;
const eventsOf = async (houseIds: string[]) =>
  (
    await sql<{ payload: Record<string, unknown> }>`select payload from game.domain_events
      where type = 'LiturgyAssigned' and payload->>'houseId' = any(${houseIds}::text[]) order by seq`.execute(
      db,
    )
  ).rows.map((row) => row.payload);

describe('désignation des liturgies (#719)', () => {
  it('la configuration et le contrat ont les mêmes genres', () => {
    expect([...CONFIG_GENRES]).toEqual([...LITURGY_GENRES]);
  });

  it('la première clôture de la saison désigne les plus riches de chaque cité, une fois même rejouée', async () => {
    // Cité 0 : a (12 000, dû plafonné à 800), b et c à égalité (5 000), c plus ancienne ; d sous le plancher ; une
    // maison PNJ et une maison exclue plus riches ; e sans foyer. Cité 1 : f seule (3 000).
    const { worldId, cities, ids } = await newWorld([
      { city: 0, grant: 12_000, age: 1 },
      { city: 0, grant: 5_000, age: 2 },
      { city: 0, grant: 5_000, age: 3 },
      { city: 0, grant: 999, age: 9 },
      { city: null, grant: 90_000, age: 9 },
      { city: 1, grant: 3_000, age: 1 },
      { city: 0, grant: 50_000, npc: true, age: 9 },
      { city: 0, grant: 40_000, banned: true, age: 9 },
    ]);
    const [a, , c, , , f] = ids;
    const twice = [liturgyAssignment, { ...liturgyAssignment, name: 'liturgyAssignmentAgain' }];
    const first = await close(worldId, MONDAY, RULES, twice);
    expect(first).toMatchObject({
      status: 'done',
      summary: {
        liturgyAssignment: { season: SEASON, assigned: 3 },
        liturgyAssignmentAgain: { season: SEASON, assigned: 0 },
      },
    });
    const written = await liturgiesOf(worldId);
    const expected = [
      [a, cities[0], '800'],
      [c, cities[0], '500'],
      [f, cities[1], '300'],
    ].sort((x, y) => ((x[1] ?? '') < (y[1] ?? '') ? -1 : (x[1] ?? '') > (y[1] ?? '') ? 1 : 0));
    expect(written.map((row) => [row.house_id, row.city_id, row.due])).toEqual(expected);
    for (const row of written) {
      expect(row).toMatchObject({
        season: SEASON,
        designated_day: MONDAY,
        due_day: MONDAY + 3,
        status: 'assigned',
      });
      expect(row.due_at).toEqual(at(MONDAY + 3));
      expect(LITURGY_GENRES).toContain(row.genre);
    }
    const events = await eventsOf(ids);
    expect(events).toHaveLength(3);
    expect(events.find((event) => event['houseId'] === a)).toMatchObject({
      cityId: cities[0],
      season: SEASON,
      due: 800,
      dueDay: MONDAY + 3,
      dueAt: at(MONDAY + 3).toISOString(),
    });
    // Rejouée : la clôture est enregistrée, rien ne change.
    expect((await close(worldId, MONDAY)).status).toBe('skipped');
    expect([(await liturgiesOf(worldId)).length, (await eventsOf(ids)).length]).toEqual([3, 3]);
  });

  it('les clôtures suivantes de la saison ne désignent rien ; une bascule manquée désigne à la clôture suivante', async () => {
    const { worldId, ids } = await newWorld([{ city: 0, grant: 5_000, age: 1 }]);
    expect((await close(worldId, MONDAY, { ...RULES, housesPerCity: 0 })).summary).toEqual({
      liturgyAssignment: { assigned: 0 },
    });
    // Mardi, même saison : rien, même si la configuration active désormais les liturgies.
    expect((await close(worldId, MONDAY + 1)).summary).toEqual({
      liturgyAssignment: { assigned: 0 },
    });
    expect(await liturgiesOf(worldId)).toEqual([]);
    // Le lundi suivant n'est pas joué (moteur arrêté) : le mercredi est la première clôture de la saison.
    expect((await close(worldId, MONDAY + 9)).summary).toEqual({
      liturgyAssignment: { season: SEASON + 1, assigned: 1 },
    });
    expect(
      (await liturgiesOf(worldId)).map((row) => [row.house_id, row.season, row.due_day]),
    ).toEqual([[ids[0], SEASON + 1, MONDAY + 12]]);
  });

  it('ni l’ordre des lignes publiques ni celui des insertions ne suivent la fortune', async () => {
    // Fortune croissante avec l'identifiant : la plus riche a le plus grand.
    const { worldId, ids, users } = await newWorld([
      { city: 0, grant: 1_000, age: 1 },
      { city: 0, grant: 2_000, age: 1 },
      { city: 0, grant: 3_000, age: 1 },
    ]);
    await close(worldId, MONDAY, { ...RULES, housesPerCity: 3 });
    const byWealth = [...ids].reverse();
    // Lecture d'un joueur du monde, sans tri : l'ordre physique des lignes, celui des insertions.
    const read = await owner.transaction().execute(async (trx) => {
      const claims = JSON.stringify({ sub: users[0], role: 'authenticated' });
      await sql`select set_config('request.jwt.claims', ${claims}, true)`.execute(trx);
      await sql`set local role authenticated`.execute(trx);
      return (
        await sql<{ house_id: string }>`select house_id from public.city_liturgies`.execute(trx)
      ).rows;
    });
    expect(read.map((row) => row.house_id)).toEqual(ids);
    expect(ids).not.toEqual(byWealth);
    expect((await eventsOf(ids)).map((event) => event['houseId'])).toEqual(ids);
  });

  it('sans section ou sans maison par cité, rien ; deux moteurs concurrents ne désignent qu’une fois', async () => {
    const quiet = await newWorld([{ city: 0, grant: 5_000, age: 1 }]);
    expect((await close(quiet.worldId, MONDAY, null)).summary).toEqual({
      liturgyAssignment: { assigned: 0 },
    });
    expect(await liturgiesOf(quiet.worldId)).toEqual([]);

    const { worldId, ids } = await newWorld([
      { city: 0, grant: 5_000, age: 1 },
      { city: 1, grant: 7_000, age: 1 },
    ]);
    const outcomes = await Promise.all([close(worldId, MONDAY), close(worldId, MONDAY)]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['done', 'skipped']);
    expect((await liturgiesOf(worldId)).length).toBe(2);
    expect(await eventsOf(ids)).toHaveLength(2);
  });

  it('une exclusion validée pendant l’étape, avant l’écriture de la liturgie : la maison est écartée, la clôture réussit (#945)', async () => {
    const { worldId, ids, users } = await newWorld([
      { city: 0, grant: 12_000, age: 1 },
      { city: 0, grant: 9_000, age: 2 },
    ]);
    const [a, b] = ids;
    // Un greffon de la connexion du moteur : armé par le crochet `house <b>`, il attend, dès la fin de l'instruction
    // suivante (le point de sauvegarde de b), qu'une autre connexion valide l'exclusion de b. La garde la voit, alors
    // que la lecture des fortunes ne la voyait pas.
    let armed = false;
    const exclude = async () => {
      const [author, validator] = [randomUUID(), randomUUID()];
      await sql`insert into auth.users (id, email) select u, u || '@example.test' from unnest(${[author, validator]}::uuid[]) u`.execute(
        owner,
      );
      await sql`insert into admin.sanctions (user_id, kind, reason, author_id, validated_by)
        values (${users[1]}, 'ban', 'Fraude', ${author}, ${validator})`.execute(owner);
    };
    const plugin: KyselyPlugin = {
      transformQuery: ({ node }) => node,
      transformResult: async ({ result }) => {
        if (armed) {
          armed = false;
          await exclude();
        }
        return result;
      },
    };
    const hooked: CloseStep = {
      name: liturgyAssignment.name,
      run: (context) =>
        liturgyAssignment.run({
          ...context,
          at: (subject) => {
            context.at?.(subject);
            if (subject === `house ${b}`) armed = true;
          },
        }),
    };
    const outcome = await runDailyClose(db.withPlugin(plugin), {
      worldId,
      gameDay: MONDAY,
      closeAt: at(MONDAY),
      config: { at: async () => ({ ...loaded, config: { ...initial, clock, liturgies: RULES } }) },
      steps: [hooked],
      now: new Date(),
    });
    expect(outcome).toMatchObject({
      status: 'done',
      summary: { liturgyAssignment: { season: SEASON, assigned: 1 } },
    });
    expect((await liturgiesOf(worldId)).map((row) => row.house_id)).toEqual([a]);
    expect((await eventsOf(ids)).map((event) => event['houseId'])).toEqual([a]);
  });
});
