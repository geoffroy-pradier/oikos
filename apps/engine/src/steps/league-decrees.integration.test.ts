import { randomUUID } from 'node:crypto';
import { ensureInitialConfig, INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import { createDb, serviceRoleUrl } from '@oikos/db';
import { gameDayAt } from '@oikos/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { leagueDecrees } from './league-decrees';

// Décrets de ligue à la clôture (6.5, #737), contre Supabase local : chaque test a son monde de cinq cités, dont les
// décrets sont posés adoptés garde levée ; l'étape les règle sous les gardes de la base.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = createDb(serviceRoleUrl(DATABASE_URL));
const owner = createDb(DATABASE_URL);
const initial = INITIAL_CONFIG as GameConfig;
const decrees = initial.decrees ?? {
  votingDays: 2,
  quorumBps: 0,
  maxOpenPerCity: 3,
  spendingCapShareBps: 0,
  models: {},
};
const LEAGUES = {
  league_found: {},
  league_join: {},
  league_admit: { maxCities: 3 },
  league_leave: {},
};
const opened: GameConfig = {
  ...initial,
  decrees: { ...decrees, models: { ...decrees.models, ...LEAGUES } },
};
const closed: GameConfig = { ...initial, decrees: { ...decrees, models: {} } };

/** Résumé de l'étape : décrets appliqués, caducs et ligues dissoutes ; aucun illisible. */
const done = (applied: number, lapsed: number, dissolved = 0) => ({
  applied,
  dissolved,
  lapsed,
  unreadable: 0,
});

beforeAll(() => ensureInitialConfig(db, INITIAL_CONFIG));
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));

async function newWorld() {
  const [worldId, houseId, userId, officeId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const cities: string[] = Array.from({ length: 5 }, () => randomUUID());
  await owner.transaction().execute(async (trx) => {
    for (const table of ['elections', 'offices'])
      await sql`alter table ${sql.table(`game.${table}`)} disable trigger ${sql.ref(`${table}_guard`)}`.execute(
        trx,
      );
    await sql`insert into game.worlds (id, slug, name) values (${worldId}, ${`l-${worldId.slice(0, 12)}`}, 'Test')`.execute(
      trx,
    );
    for (const [index, cityId] of cities.entries())
      await sql`insert into game.cities (id, world_id, slug, name) values (${cityId}, ${worldId}, ${`c${index}`}, 'C')`.execute(
        trx,
      );
    await sql`with player as (insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`}))
      insert into game.houses (id, world_id, user_id, name, blazon) values (${houseId}, ${worldId}, ${userId}, 'Maison Test', '{}')`.execute(
      trx,
    );
    await sql`with e as (insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at, tallied_at)
        values (${worldId}, ${cities[0]}, 'archon', now() - interval '9 days', now() - interval '8 days', now() - interval '7 days', now() + interval '20 days', now())
        returning *)
      insert into game.offices (id, world_id, city_id, office, house_id, election_id, starts_at, ends_at)
      select ${officeId}, world_id, city_id, office, ${houseId}, id, voting_closes_at, term_ends_at from e`.execute(
      trx,
    );
    for (const table of ['elections', 'offices'])
      await sql`alter table ${sql.table(`game.${table}`)} enable trigger ${sql.ref(`${table}_guard`)}`.execute(
        trx,
      );
  });
  /** Décret adopté de la cité `city`, posé garde levée ; les suivants finissent leur vote après lui. */
  let order = 0;
  const adopt = async (city: number, model: string, params: object = {}) => {
    const id = randomUUID();
    order += 1;
    await owner.transaction().execute(async (trx) => {
      await sql`alter table game.decrees disable trigger decrees_guard`.execute(trx);
      await sql`insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at,
          voting_closes_at, quorum_bps, status, tallied_at, electorate, votes_for, votes_against)
        values (${id}, ${worldId}, ${cities[city]}, ${model}, ${JSON.stringify(params)}, ${officeId}, ${houseId},
          now() - interval '3 days', now() - interval '2 days' + ${order} * interval '1 second', 0, 'adopted', now(), 0, 0, 0)`.execute(
        trx,
      );
      await sql`alter table game.decrees enable trigger decrees_guard`.execute(trx);
    });
    return id;
  };
  const step = (config: GameConfig = opened) =>
    db.transaction().execute((trx) =>
      leagueDecrees.run({
        trx,
        worldId,
        gameDay: gameDayAt(new Date(), config.clock),
        closeAt: new Date(),
        config,
      }),
    );
  const city = (id: string | null | undefined) => (id ? `c${cities.indexOf(id)}` : null);
  /** États des décrets, événements de la clôture et membres en activité, cités nommées `c0` à `c4`. */
  const read = async () => {
    const rows = await db
      .selectFrom('game.decrees')
      .select(['id', 'status'])
      .where('world_id', '=', worldId)
      .orderBy('voting_closes_at')
      .execute();
    const events = (
      await sql<{
        type: string;
        payload: Record<string, string | boolean | null>;
      }>`select type, payload from game.domain_events
        where payload ->> 'decreeId' = any(${rows.map((row) => row.id)}::text[]) order by seq`.execute(
        db,
      )
    ).rows.map(({ type, payload }) =>
      [
        type,
        city(payload['cityId'] as string),
        payload['reason'] ?? city(payload['hegemonCityId'] as string | null) ?? '',
      ].join(':'),
    );
    const members = await db
      .selectFrom('game.league_members as m')
      .innerJoin('game.leagues as l', 'l.id', 'm.league_id')
      .select(['l.name', 'm.city_id', 'l.hegemon_city_id'])
      .where('m.world_id', '=', worldId)
      .where('m.left_at', 'is', null)
      .orderBy('m.joined_at')
      .orderBy('m.id')
      .execute();
    return {
      ids: rows.map((row) => row.id),
      statuses: rows.map((row) => row.status).join(' '),
      events,
      members: members.map(
        (m) => `${m.name}:${city(m.city_id)}${m.hegemon_city_id === m.city_id ? '*' : ''}`,
      ),
    };
  };
  const league = async () =>
    (
      await db
        .selectFrom('game.leagues')
        .select('id')
        .where('hegemon_city_id', '=', cities[0] ?? '')
        .executeTakeFirstOrThrow()
    ).id;
  return { adopt, step, read, cities, league };
}

describe('décrets de ligue à la clôture', () => {
  it('modèles fermés : caducs, une fois ; ouverts : fondation, et rejouée, rien de plus', async () => {
    const world = await newWorld();
    await world.adopt(0, 'league_found', { name: 'Ligue de Délos' });
    await world.adopt(1, 'league_join', { leagueId: randomUUID() });
    expect(await world.step(closed)).toEqual(done(0, 2));
    expect(await world.step(closed)).toEqual(done(0, 0));
    await world.adopt(0, 'league_found', { name: 'Ligue de Délos' });
    await world.adopt(1, 'league_found', { name: 'LIGUE DE DÉLOS' });
    await world.adopt(0, 'league_found', { name: 'Ligue de Paros' });
    expect(await world.step()).toEqual(done(1, 2));
    expect(await world.step()).toEqual(done(0, 0));
    expect(await world.read()).toMatchObject({
      statuses: 'lapsed lapsed applied lapsed lapsed',
      events: [
        'DecreeLapsed:c0:model_closed',
        'DecreeLapsed:c1:model_closed',
        'LeagueFounded:c0:',
        'DecreeLapsed:c1:name_taken',
        'DecreeLapsed:c0:in_league',
      ],
      members: ['Ligue de Délos:c0*'],
    });
    // La fondatrice, seule, s'en va : la ligue se dissout, et son nom se reprend.
    await world.adopt(0, 'league_leave');
    await world.adopt(1, 'league_found', { name: 'Ligue de Délos' });
    expect(await world.step()).toEqual(done(2, 0, 1));
    const { events, members } = await world.read();
    expect(events.slice(5)).toEqual(['LeagueLeft:c0:left', 'LeagueFounded:c1:']);
    expect(members).toEqual(['Ligue de Délos:c1*']);
  });

  it('demande d’entrée : enregistrée d’une cité hors ligue vers une ligue en activité, même en majuscules', async () => {
    const world = await newWorld();
    await world.adopt(0, 'league_found', { name: 'Ligue de Délos' });
    await world.step();
    const { id: leagueId } = await db
      .selectFrom('game.leagues')
      .select('id')
      .where('founding_decree_id', '=', (await world.read()).ids[0] ?? '')
      .executeTakeFirstOrThrow();
    await world.adopt(0, 'league_join', { leagueId });
    // Paramètres écrits hors de l'API, identifiant en majuscules : la clôture règle la demande sans échouer.
    await world.adopt(1, 'league_join', { leagueId: leagueId.toUpperCase() });
    await world.adopt(2, 'league_join', { leagueId: randomUUID() });
    expect(await world.step()).toEqual(done(1, 2));
    const { statuses, events, members } = await world.read();
    expect(statuses).toBe('applied lapsed applied lapsed');
    expect(events.slice(1)).toEqual([
      'DecreeLapsed:c0:in_league',
      'DecreeLapsed:c2:league_inactive',
    ]);
    expect(members).toEqual(['Ligue de Délos:c0*']);
  });

  it('deux clôtures à la fois : la seconde attend le décret, le trouve réglé et ne fonde rien', async () => {
    const world = await newWorld();
    await world.adopt(0, 'league_found', { name: 'Ligue de Délos' });
    const runs = await Promise.all([world.step(), world.step()]);
    expect(runs.map((run) => run.applied).sort()).toEqual([0, 1]);
    expect((await world.read()).members).toEqual(['Ligue de Délos:c0*']);
  });

  it('admission par l’hégémon, même en majuscules, une fois par demande ; au-delà de maxCities, caduque', async () => {
    const world = await newWorld();
    await world.adopt(0, 'league_found', { name: 'Ligue de Délos' });
    await world.step();
    const leagueId = await world.league();
    const asks = [];
    for (const city of [1, 2, 3]) asks.push(await world.adopt(city, 'league_join', { leagueId }));
    await world.adopt(4, 'league_join', { leagueId: randomUUID() });
    await world.step();
    await world.adopt(1, 'league_admit', { joinDecreeId: asks[0] });
    await world.adopt(0, 'league_admit', { joinDecreeId: randomUUID() });
    await world.adopt(0, 'league_admit', { joinDecreeId: asks[0] });
    await world.adopt(0, 'league_admit', { joinDecreeId: asks[0] });
    await world.adopt(0, 'league_admit', { joinDecreeId: asks[1]?.toUpperCase() });
    await world.adopt(0, 'league_admit', { joinDecreeId: asks[2] });
    expect(await world.step()).toEqual(done(2, 4));
    const { statuses, events, members } = await world.read();
    expect(statuses).toBe(
      'applied applied applied applied lapsed lapsed lapsed applied lapsed applied lapsed',
    );
    expect(events.slice(1)).toEqual([
      'DecreeLapsed:c4:league_inactive',
      'DecreeLapsed:c1:not_hegemon',
      'DecreeLapsed:c0:no_request',
      'LeagueJoined:c1:c0',
      'DecreeLapsed:c0:request_stale',
      'LeagueJoined:c2:c0',
      'DecreeLapsed:c0:league_full',
    ]);
    expect([...members].sort()).toEqual([
      'Ligue de Délos:c0*',
      'Ligue de Délos:c1',
      'Ligue de Délos:c2',
    ]);
  });

  it('départs : l’hégémonie au plus ancien membre, entré à une clôture d’avant ; réduite à une cité, la ligue se dissout', async () => {
    const world = await newWorld();
    await world.adopt(0, 'league_found', { name: 'Ligue de Délos' });
    await world.step();
    const leagueId = await world.league();
    const asks = [
      await world.adopt(1, 'league_join', { leagueId }),
      await world.adopt(2, 'league_join', { leagueId }),
    ];
    await world.step();
    for (const ask of asks) {
      await world.adopt(0, 'league_admit', { joinDecreeId: ask });
      await world.step();
    }
    await world.adopt(0, 'league_leave');
    await world.adopt(3, 'league_leave');
    expect(await world.step()).toEqual(done(1, 1));
    expect((await world.read()).members).toEqual(['Ligue de Délos:c1*', 'Ligue de Délos:c2']);
    await world.adopt(2, 'league_leave');
    await world.adopt(4, 'league_join', { leagueId });
    expect(await world.step()).toEqual(done(1, 1, 1));
    expect(await world.step()).toEqual(done(0, 0));
    const { events, members } = await world.read();
    expect(events.slice(3)).toEqual([
      'LeagueLeft:c0:left',
      'DecreeLapsed:c3:not_in_league',
      'LeagueLeft:c2:left',
      'LeagueLeft:c1:dissolved',
      'DecreeLapsed:c4:league_inactive',
    ]);
    expect(members).toEqual([]);
    const league = await db
      .selectFrom('game.leagues')
      .select(['dissolved_at', 'hegemon_city_id'])
      .where('id', '=', leagueId)
      .executeTakeFirstOrThrow();
    expect([league.dissolved_at !== null, world.cities.indexOf(league.hegemon_city_id)]).toEqual([
      true,
      1,
    ]);
  });
});
