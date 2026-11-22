import { decreeProposalSchema, type DecreeProposal } from '@oikos/contracts';
import { findBannedTerm, type GameConfig } from '@oikos/config';
import { sanctionRefusal, type Db } from '@oikos/db';
import { sql } from 'kysely';
import { type CommandResult } from '../registry';
import { refuse } from './city-election';

/** Forme d'un nom de ligue en base, celle d'un nom de maison : Postgres et JavaScript n'ont pas les mêmes lettres. */
const NAME_IN_DATABASE = `^[[:alpha:]][[:alpha:] '-]{1,22}[[:alpha:]]$`;

const inLeague = async (trx: Db, cityId: string) =>
  (await trx
    .selectFrom('game.league_members')
    .select('id')
    .where('city_id', '=', cityId)
    .where('left_at', 'is', null)
    .executeTakeFirst()) !== undefined;

/** Ligue en activité du monde, et sa cité hégémon. */
const activeLeague = (trx: Db, worldId: string, leagueId: string) =>
  trx
    .selectFrom('game.leagues')
    .select('hegemon_city_id')
    .where('id', '=', leagueId)
    .where('world_id', '=', worldId)
    .where('dissolved_at', 'is', null)
    .executeTakeFirst();

/**
 * Contrôles d'un décret de ligue à sa proposition (6.5, #737), lus sans verrou : la clôture refait chacun à
 * l'application et rend caduc le décret que les ligues ne permettent plus. Le nom d'une ligue est un texte public,
 * comme un nom de maison : filtré par le vocabulaire de la discussion, refusé à un compte réduit au silence.
 */
export async function leagueRefusal(
  trx: Db,
  userId: string,
  house: { world_id: string; city_id: string },
  decree: DecreeProposal,
  config: Pick<GameConfig, 'moderation'>,
): Promise<CommandResult<never> | null> {
  switch (decree.model) {
    case 'league_found': {
      const { name } = decree.params;
      if (findBannedTerm(config.moderation.bannedTerms, name) !== null)
        return refuse('MESSAGE_REJECTED', 'The name contains a banned term.');
      if ((await sanctionRefusal(trx, userId, { speech: true })) === 'SILENCED')
        return refuse('SILENCED', 'This account is silenced.');
      const { rows } = await sql<{
        ok: boolean;
      }>`select ${name} ~ ${NAME_IN_DATABASE} as ok`.execute(trx);
      if (!rows[0]?.ok)
        return {
          ok: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid league name.',
            fields: ['params.name'],
          },
        };
      if (await inLeague(trx, house.city_id))
        return refuse('IN_LEAGUE', 'The city is already in a league.');
      const taken = await trx
        .selectFrom('game.leagues')
        .select('id')
        .where('world_id', '=', house.world_id)
        .where('dissolved_at', 'is', null)
        .where(sql<boolean>`lower(name) = lower(${name})`)
        .executeTakeFirst();
      return taken ? refuse('LEAGUE_NAME_TAKEN', 'A league already bears this name.') : null;
    }
    case 'league_join':
      if (await inLeague(trx, house.city_id))
        return refuse('IN_LEAGUE', 'The city is already in a league.');
      return (await activeLeague(trx, house.world_id, decree.params.leagueId))
        ? null
        : refuse('LEAGUE_NOT_FOUND', 'No such league.');
    case 'league_admit': {
      const asked = await trx
        .selectFrom('game.decrees')
        .select('params')
        .where('id', '=', decree.params.joinDecreeId)
        .where('world_id', '=', house.world_id)
        .where('model', '=', 'league_join')
        .where('status', '=', 'applied')
        .executeTakeFirst();
      const request = decreeProposalSchema.safeParse({
        model: 'league_join',
        params: asked?.params,
      });
      const league =
        request.data?.model === 'league_join' &&
        (await activeLeague(trx, house.world_id, request.data.params.leagueId));
      if (!league) return refuse('LEAGUE_REQUEST_NOT_FOUND', 'No such request to join a league.');
      return league.hegemon_city_id === house.city_id
        ? null
        : refuse('NOT_HEGEMON', 'Only the hegemon city admits a city into its league.');
    }
    case 'league_leave':
      return (await inLeague(trx, house.city_id))
        ? null
        : refuse('NOT_IN_LEAGUE', 'The city is in no league.');
    default:
      return null;
  }
}
