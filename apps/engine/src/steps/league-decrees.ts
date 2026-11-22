import {
  decreeLapsedSchema,
  decreeProposalSchema,
  leagueFoundedSchema,
  leagueJoinedSchema,
  leagueLeftSchema,
  type DecreeParams,
  type DecreeProposal,
  type DomainEvent,
  type LEAGUE_LAPSE_REASONS,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import type { CloseContext, CloseStep } from '../close';

const MODELS = ['league_found', 'league_join', 'league_admit', 'league_leave'] as const;
type LapseReason = (typeof LEAGUE_LAPSE_REASONS)[number] | 'model_closed';
type Due = { id: string; city_id: string };
type Models = NonNullable<CloseContext['config']['decrees']>['models'];
/** Ce que l'application d'un décret écrit : ses événements, ou la raison de sa caducité. */
type Outcome = { events: DomainEvent[] } | { lapsed: LapseReason };

/**
 * Décrets de ligue (6.3, 6.5 ; #737), juste après le dépouillement des décrets qui les adopte, avant l'entretien. Chaque
 * décret adopté de fondation, de demande d'entrée, d'admission ou de départ du monde est réglé une fois, dans l'ordre de
 * la fin de leur vote, contre la configuration et les ligues du moment : appliqué avec son effet (ligue fondée, demande
 * enregistrée, cité admise, cité sortie) et ses événements, ou caduc (`DecreeLapsed`, avec sa raison). Une ligue réduite
 * à une cité se dissout ; l'hégémon qui s'en va laisse l'hégémonie au plus ancien membre. La base vérifie chaque effet
 * et n'admet qu'un règlement par décret : rejouée, l'étape ne fait rien de plus. Ni monnaie ni stock ; verrous : le
 * décret, puis sa ligue. Un décret aux paramètres illisibles reste adopté, compté.
 */
export const leagueDecrees: CloseStep = {
  name: 'leagueDecrees',
  async run({ trx, worldId, config, at }) {
    const summary = { applied: 0, dissolved: 0, lapsed: 0, unreadable: 0 };
    const due = await trx
      .selectFrom('game.decrees')
      .select(['id', 'city_id', 'model', 'params'])
      .where('world_id', '=', worldId)
      .where('status', '=', 'adopted')
      .where('model', 'in', MODELS)
      .orderBy('voting_closes_at')
      .orderBy('id')
      .execute();
    const models: Models = config.decrees?.models ?? {};
    for (const row of due) {
      at?.(`decree ${row.id}`);
      const locked = await trx
        .selectFrom('game.decrees')
        .select('id')
        .where('id', '=', row.id)
        .where('status', '=', 'adopted')
        .forUpdate()
        .executeTakeFirst();
      if (!locked) continue;
      const parsed = decreeProposalSchema.safeParse({ model: row.model, params: row.params });
      const decree = parsed.success ? parsed.data : null;
      const outcome = decree && (await settle(trx, worldId, row, decree, models));
      if (!decree || !outcome) {
        console.error(`Decree ${row.id} has unreadable parameters: left adopted`);
        summary.unreadable += 1;
        continue;
      }
      const events =
        'lapsed' in outcome
          ? [
              decreeLapsedSchema.parse({
                type: 'DecreeLapsed',
                payload: { decreeId: row.id, cityId: row.city_id, decree, reason: outcome.lapsed },
              }),
            ]
          : outcome.events;
      await trx
        .updateTable('game.decrees')
        .set(
          'lapsed' in outcome
            ? { status: 'lapsed' }
            : { status: 'applied', applied_at: sql<Date>`now()` },
        )
        .where('id', '=', row.id)
        .execute();
      for (const event of events)
        await trx
          .insertInto('game.domain_events')
          .values({ command_id: null, type: event.type, payload: JSON.stringify(event.payload) })
          .execute();
      if ('lapsed' in outcome) summary.lapsed += 1;
      else summary.applied += 1;
      if (events.some((event) => event.type === 'LeagueLeft' && event.payload.dissolved))
        summary.dissolved += 1;
    }
    return summary;
  },
};

const CLOSED: Outcome = { lapsed: 'model_closed' };
/** Règlement d'un décret de ligue, s'il en est un ; caduc si la configuration ne l'ouvre plus. */
async function settle(
  trx: Db,
  worldId: string,
  row: Due,
  decree: DecreeProposal,
  models: Models,
): Promise<Outcome | null> {
  switch (decree.model) {
    case 'league_found':
      return models.league_found ? found(trx, worldId, row, decree.params) : CLOSED;
    case 'league_join':
      return models.league_join ? request(trx, worldId, row, decree.params) : CLOSED;
    case 'league_admit':
      return models.league_admit
        ? admit(trx, worldId, row, decree.params, models.league_admit.maxCities)
        : CLOSED;
    case 'league_leave':
      return models.league_leave ? leave(trx, worldId, row) : CLOSED;
    default:
      return null;
  }
}

/** Ligue d'une cité, et son appartenance ; aucune hors de toute ligue. */
const membershipOf = (trx: Db, cityId: string) =>
  trx
    .selectFrom('game.league_members')
    .select(['id', 'league_id'])
    .where('city_id', '=', cityId)
    .where('left_at', 'is', null)
    .executeTakeFirst();

/** Ligue en activité de ce monde, verrouillée : ses entrées et ses sorties se comptent l'une après l'autre. */
const activeLeague = (trx: Db, worldId: string, leagueId: string) =>
  trx
    .selectFrom('game.leagues')
    .select(['id', 'name', 'hegemon_city_id'])
    .where('id', '=', leagueId)
    .where('world_id', '=', worldId)
    .where('dissolved_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();

/** Membres en activité d'une ligue, du plus ancien au plus récent. */
const membersOf = (trx: Db, leagueId: string) =>
  trx
    .selectFrom('game.league_members')
    .select(['id', 'city_id'])
    .where('league_id', '=', leagueId)
    .where('left_at', 'is', null)
    .orderBy('joined_at')
    .orderBy('id')
    .execute();

async function found(
  trx: Db,
  worldId: string,
  row: Due,
  { name }: DecreeParams<'league_found'>,
): Promise<Outcome> {
  if (await membershipOf(trx, row.city_id)) return { lapsed: 'in_league' };
  const taken = await trx
    .selectFrom('game.leagues')
    .select('id')
    .where('world_id', '=', worldId)
    .where('dissolved_at', 'is', null)
    .where(sql<boolean>`lower(name) = lower(${name})`)
    .executeTakeFirst();
  if (taken) return { lapsed: 'name_taken' };
  const league = await trx
    .insertInto('game.leagues')
    .values({ world_id: worldId, name, hegemon_city_id: row.city_id, founding_decree_id: row.id })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('game.league_members')
    .values({
      league_id: league.id,
      world_id: worldId,
      city_id: row.city_id,
      entry_decree_id: row.id,
    })
    .execute();
  const payload = { leagueId: league.id, name, decreeId: row.id, cityId: row.city_id };
  return { events: [leagueFoundedSchema.parse({ type: 'LeagueFounded', payload })] };
}

/** Demande d'entrée : enregistrée par son application, sans autre effet ; la cité hégémon l'admettra ou non. */
async function request(
  trx: Db,
  worldId: string,
  row: Due,
  { leagueId }: DecreeParams<'league_join'>,
): Promise<Outcome> {
  if (await membershipOf(trx, row.city_id)) return { lapsed: 'in_league' };
  if (!(await activeLeague(trx, worldId, leagueId))) return { lapsed: 'league_inactive' };
  return { events: [] };
}

async function admit(
  trx: Db,
  worldId: string,
  row: Due,
  { joinDecreeId }: DecreeParams<'league_admit'>,
  maxCities: number,
): Promise<Outcome> {
  const asked = await trx
    .selectFrom('game.decrees')
    .select(['id', 'city_id', 'params', 'applied_at'])
    .where('id', '=', joinDecreeId)
    .where('world_id', '=', worldId)
    .where('model', '=', 'league_join')
    .where('status', '=', 'applied')
    .executeTakeFirst();
  const parsed = decreeProposalSchema.safeParse({ model: 'league_join', params: asked?.params });
  if (!asked?.applied_at || parsed.data?.model !== 'league_join') return { lapsed: 'no_request' };
  const league = await activeLeague(trx, worldId, parsed.data.params.leagueId);
  if (!league) return { lapsed: 'league_inactive' };
  if (league.hegemon_city_id !== row.city_id) return { lapsed: 'not_hegemon' };
  // Entrée dans une ligue depuis la demande, celle-ci comprise : la demande a servi ou ne vaut plus.
  const since = await trx
    .selectFrom('game.league_members')
    .select('id')
    .where('city_id', '=', asked.city_id)
    .where('joined_at', '>=', asked.applied_at)
    .executeTakeFirst();
  if (since || (await membershipOf(trx, asked.city_id))) return { lapsed: 'request_stale' };
  if ((await membersOf(trx, league.id)).length >= maxCities) return { lapsed: 'league_full' };
  await trx
    .insertInto('game.league_members')
    .values({
      league_id: league.id,
      world_id: worldId,
      city_id: asked.city_id,
      entry_decree_id: row.id,
    })
    .execute();
  const payload = {
    leagueId: league.id,
    name: league.name,
    decreeId: row.id,
    requestDecreeId: asked.id,
    cityId: asked.city_id,
    hegemonCityId: row.city_id,
  };
  return { events: [leagueJoinedSchema.parse({ type: 'LeagueJoined', payload })] };
}

/**
 * Départ : la cité sort ; une ligue sans autre membre, ou réduite à un seul, se dissout (ce dernier sort avec elle) ;
 * sinon, si la cité était l'hégémon, l'hégémonie passe au plus ancien membre restant.
 */
async function leave(trx: Db, worldId: string, row: Due): Promise<Outcome> {
  const membership = await membershipOf(trx, row.city_id);
  if (!membership) return { lapsed: 'not_in_league' };
  // La ligue d'un membre est en activité : une ligue dissoute n'en a plus.
  const locked = await activeLeague(trx, worldId, membership.league_id);
  if (!locked) throw new Error(`League ${membership.league_id} has a member but is not active`);
  const exit = (reason: 'left' | 'dissolved', decreeId: string | null) => ({
    left_at: sql<Date>`now()`,
    exit_reason: reason,
    exit_decree_id: decreeId,
  });
  await trx
    .updateTable('game.league_members')
    .set(exit('left', row.id))
    .where('id', '=', membership.id)
    .execute();
  const remaining = await membersOf(trx, locked.id);
  const dissolved = remaining.length <= 1;
  const last = remaining[0];
  if (dissolved && last)
    await trx
      .updateTable('game.league_members')
      .set(exit('dissolved', null))
      .where('id', '=', last.id)
      .execute();
  const hegemon = dissolved
    ? null
    : locked.hegemon_city_id === row.city_id
      ? (last?.city_id ?? null)
      : locked.hegemon_city_id;
  if (dissolved)
    await trx
      .updateTable('game.leagues')
      .set({ dissolved_at: sql<Date>`now()` })
      .where('id', '=', locked.id)
      .execute();
  else if (hegemon !== locked.hegemon_city_id && hegemon)
    await trx
      .updateTable('game.leagues')
      .set({ hegemon_city_id: hegemon })
      .where('id', '=', locked.id)
      .execute();
  const base = {
    leagueId: locked.id,
    name: locked.name,
    decreeId: row.id,
    hegemonCityId: hegemon,
    dissolved,
  };
  const left = (cityId: string, reason: 'left' | 'dissolved') =>
    leagueLeftSchema.parse({ type: 'LeagueLeft', payload: { ...base, cityId, reason } });
  return {
    events: [
      left(row.city_id, 'left'),
      ...(dissolved && last ? [left(last.city_id, 'dissolved')] : []),
    ],
  };
}
