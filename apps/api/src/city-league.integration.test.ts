import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appWithConfig,
  code,
  db,
  DECREES,
  newWorld,
  owner,
  propose,
  rows,
} from './city-decree.integration-fixtures';

// Décrets de ligue à la proposition (6.5, #737), contre Supabase local. Les ligues et les demandes d'entrée sont posées
// garde levée ; la clôture refait chaque contrôle à l'application.
afterAll(() => Promise.all([db.destroy(), owner.destroy()]));
const LEAGUES = {
  league_found: {},
  league_join: {},
  league_admit: { maxCities: 5 },
  league_leave: {},
};
const open = appWithConfig((config) => ({
  ...config,
  moderation: { ...config.moderation, bannedTerms: ['Maudit'] },
  decrees: { ...DECREES, maxOpenPerCity: 100, models: { ...DECREES.models, ...LEAGUES } },
}));
const found = (name: string) => ({ model: 'league_found', params: { name } });
const join = (leagueId: string) => ({ model: 'league_join', params: { leagueId } });
const admit = (joinDecreeId: string) => ({ model: 'league_admit', params: { joinDecreeId } });
const LEAVE = { model: 'league_leave', params: {} };

/** Ligue fondée par `cityId` sous `name`, et demande d'entrée appliquée de `asking` vers elle ; gardes levées. */
async function pose(
  world: Awaited<ReturnType<typeof newWorld>>,
  cityId: string,
  name: string,
  asking: string,
) {
  const [leagueId, founding, request] = [randomUUID(), randomUUID(), randomUUID()];
  await owner.transaction().execute(async (trx) => {
    for (const table of ['decrees', 'leagues', 'league_members'])
      await sql`alter table ${sql.table(`game.${table}`)} disable trigger ${sql.ref(`${table}_guard`)}`.execute(
        trx,
      );
    await sql`insert into game.decrees (id, world_id, city_id, model, params, office_id, proposed_by, proposed_at,
        voting_closes_at, quorum_bps, status, tallied_at, electorate, votes_for, votes_against, applied_at)
      select d.id, ${world.worldId}, d.city, d.model, d.params, o.id, o.house_id, now() - interval '3 days',
        now() - interval '1 day', 0, 'applied', now() - interval '1 day', 0, 0, 0, now() - interval '1 hour'
      from game.offices o, (values (${founding}::uuid, ${cityId}::uuid, 'league_found', ${JSON.stringify({ name })}::jsonb),
        (${request}::uuid, ${asking}::uuid, 'league_join', ${JSON.stringify({ leagueId })}::jsonb)) as d (id, city, model, params)
      where o.world_id = ${world.worldId}`.execute(trx);
    await sql`insert into game.leagues (id, world_id, name, hegemon_city_id, founding_decree_id)
      values (${leagueId}, ${world.worldId}, ${name}, ${cityId}, ${founding})`.execute(trx);
    await sql`insert into game.league_members (league_id, world_id, city_id, entry_decree_id)
      values (${leagueId}, ${world.worldId}, ${cityId}, ${founding})`.execute(trx);
    for (const table of ['decrees', 'leagues', 'league_members'])
      await sql`alter table ${sql.table(`game.${table}`)} enable trigger ${sql.ref(`${table}_guard`)}`.execute(
        trx,
      );
  });
  return { leagueId, request };
}
const codes = async (user: string, decrees: unknown[]) => {
  const replies = [];
  for (const decree of decrees) replies.push(code(await propose(user, decree, undefined, open)));
  return replies;
};

describe('city.proposeDecree : décrets de ligue', () => {
  it('fermés par la configuration initiale', async () => {
    const { alice } = await newWorld();
    expect(code(await propose(alice.user, found('Ligue de Délos')))).toBe('DECREE_MODEL_CLOSED');
  });

  it('hors de toute ligue : fonder sous un nom libre et propre, demander une ligue en activité', async () => {
    const world = await newWorld();
    const elaia = await pose(world, world.elaia, 'Ligue de Délos', world.kalliste);
    expect(
      await codes(world.alice.user, [
        found('Ligue Maudit'),
        found('LIGUE DE DÉLOS'),
        found('Ligue de Paros'),
        join(randomUUID()),
        join(elaia.leagueId.toUpperCase()),
        admit(randomUUID()),
        admit(elaia.request),
        LEAVE,
      ]),
    ).toEqual([
      'MESSAGE_REJECTED',
      'LEAGUE_NAME_TAKEN',
      'ok',
      'LEAGUE_NOT_FOUND',
      'ok',
      'LEAGUE_REQUEST_NOT_FOUND',
      'NOT_HEGEMON',
      'NOT_IN_LEAGUE',
    ]);
    // La demande, faite avec l'identifiant en majuscules, est enregistrée en minuscules.
    const [asked] = await rows(sql<{ params: unknown }>`select params from game.decrees
      where world_id = ${world.worldId} and model = 'league_join' and status = 'proposed'`);
    expect(asked?.params).toEqual({ leagueId: elaia.leagueId });
  });

  it('hégémon d’une ligue : ni fonder ni demander, mais admettre une demande vers elle, et partir', async () => {
    const world = await newWorld();
    const own = await pose(world, world.kalliste, 'Ligue de Délos', world.elaia);
    expect(
      await codes(world.alice.user, [
        found('Ligue de Paros'),
        join(own.leagueId),
        admit(own.request),
        LEAVE,
      ]),
    ).toEqual(['IN_LEAGUE', 'IN_LEAGUE', 'ok', 'ok']);
  });

  it('un nom de ligue est un texte public : refusé à un compte réduit au silence', async () => {
    const world = await newWorld();
    const moderator = randomUUID();
    await sql`with author as (insert into auth.users (id, email) values (${moderator}, ${`${moderator}@example.test`}))
      insert into admin.sanctions (user_id, kind, starts_at, ends_at, reason, author_id)
      values (${world.alice.user}, 'silence', now() - interval '1 minute', now() + interval '1 hour', 'Essai', ${moderator})`.execute(
      owner,
    );
    expect(await codes(world.alice.user, [found('Ligue de Paros'), LEAVE])).toEqual([
      'SILENCED',
      'NOT_IN_LEAGUE',
    ]);
  });
});
