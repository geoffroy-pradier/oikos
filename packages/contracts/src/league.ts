import { z } from 'zod';

/**
 * Ligues (docs/specs/06-cites-politique-communaute.md, 6.5 ; #737). Une cité fonde une ligue par décret, une autre
 * demande à y entrer et la cité hégémon l'admet par décret, une cité la quitte par décret ; une ligue réduite à une
 * seule cité se dissout. La clôture écrit ces faits et les annonce ; chaque événement porte le nom de la ligue, que
 * la chronique cite.
 */
export const LEAGUE_EXIT_REASONS = ['left', 'dissolved'] as const;
export type LeagueExitReason = (typeof LEAGUE_EXIT_REASONS)[number];

const league = { leagueId: z.uuid(), name: z.string().min(1) };

/** Fondation : la cité du décret fonde la ligue, en est le premier membre et l'hégémon. */
export const leagueFoundedSchema = z.strictObject({
  type: z.literal('LeagueFounded'),
  payload: z.strictObject({ ...league, decreeId: z.uuid(), cityId: z.uuid() }),
});
/** Entrée : la cité hégémon (`hegemonCityId`) admet par son décret la demande d'entrée de `cityId`. */
export const leagueJoinedSchema = z.strictObject({
  type: z.literal('LeagueJoined'),
  payload: z.strictObject({
    ...league,
    decreeId: z.uuid(),
    requestDecreeId: z.uuid(),
    cityId: z.uuid(),
    hegemonCityId: z.uuid(),
  }),
});
/**
 * Sortie : par le décret de départ de la cité (`left`), ou, pour la dernière cité, par la dissolution que ce départ
 * entraîne (`dissolved`), sous le même décret. `hegemonCityId` est l'hégémon après la sortie, nul si la ligue se
 * dissout.
 */
export const leagueLeftSchema = z.strictObject({
  type: z.literal('LeagueLeft'),
  payload: z
    .strictObject({
      ...league,
      decreeId: z.uuid(),
      cityId: z.uuid(),
      reason: z.enum(LEAGUE_EXIT_REASONS),
      hegemonCityId: z.uuid().nullable(),
      dissolved: z.boolean(),
    })
    .refine((payload) => payload.dissolved === (payload.hegemonCityId === null), {
      message: 'a dissolved league, and only it, has no hegemon',
      path: ['hegemonCityId'],
    })
    .refine((payload) => payload.reason === 'left' || payload.dissolved, {
      message: 'a city leaves by dissolution only with its league',
      path: ['reason'],
    }),
});
