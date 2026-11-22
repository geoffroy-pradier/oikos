import { describe, expect, it } from 'vitest';
import {
  boundedDecreeParamsSchemas,
  cityProposeDecreeInputSchema,
  decreeSpendingOboles,
} from './decree';
import { domainEventSchema } from './events';

const CITY = '01900000-0000-7000-8000-000000000101';
const OTHER = '01900000-0000-7000-8000-000000000103';
const LEAGUE = '01900000-0000-7000-8000-0000000000e1';
const DECREE = '01900000-0000-7000-8000-0000000000d1';
const parse = (input: unknown) => cityProposeDecreeInputSchema.safeParse(input).success;
const event = (type: string, payload: object) =>
  domainEventSchema.safeParse({ type, payload }).success;

describe('décrets de ligue (6.5 ; #737)', () => {
  it('fonder sous un nom de la forme d’un nom de maison, demander une ligue, admettre une demande, partir', () => {
    expect(parse({ model: 'league_found', params: { name: 'Ligue de Délos' } })).toBe(true);
    for (const name of ['L', 'Ligue 1', ' Ligue', 'Ligue de la mer Égée du Nord'])
      expect([name, parse({ model: 'league_found', params: { name } })]).toEqual([name, false]);
    expect(parse({ model: 'league_join', params: { leagueId: LEAGUE } })).toBe(true);
    expect(parse({ model: 'league_join', params: { leagueId: 'délos' } })).toBe(false);
    // Un identifiant en majuscules est rendu en minuscules, à l'entrée comme borné par la configuration.
    const upper = { model: 'league_admit', params: { joinDecreeId: DECREE.toUpperCase() } };
    expect(cityProposeDecreeInputSchema.parse(upper).params).toEqual({ joinDecreeId: DECREE });
    expect(
      boundedDecreeParamsSchemas({ league_join: {} }).league_join?.parse({
        leagueId: LEAGUE.toUpperCase(),
      }),
    ).toEqual({ leagueId: LEAGUE });
    expect(parse({ model: 'league_admit', params: { joinDecreeId: DECREE } })).toBe(true);
    expect(parse({ model: 'league_admit', params: { cityId: CITY } })).toBe(false);
    expect(parse({ model: 'league_leave', params: {} })).toBe(true);
    expect(parse({ model: 'league_leave', params: { leagueId: LEAGUE } })).toBe(false);
    expect(decreeSpendingOboles({ model: 'league_leave', params: {} })).toBe(0);
  });

  it('fermés tant que la configuration ne les ouvre pas, chacun à part', () => {
    const closed = boundedDecreeParamsSchemas({});
    for (const model of ['league_found', 'league_join', 'league_admit', 'league_leave'] as const)
      expect(closed[model]).toBeUndefined();
    const open = boundedDecreeParamsSchemas({ league_admit: { maxCities: 5 } });
    expect(open.league_admit?.parse({ joinDecreeId: DECREE })).toEqual({ joinDecreeId: DECREE });
    expect(open.league_found).toBeUndefined();
    expect(
      boundedDecreeParamsSchemas({ league_found: {} }).league_found?.safeParse({ name: 'L' })
        .success,
    ).toBe(false);
  });

  it('caducité : les raisons des ligues pour les seuls décrets de ligue, sans montant', () => {
    const lapsed = (decree: unknown, extra: object) =>
      event('DecreeLapsed', { decreeId: DECREE, cityId: CITY, decree, ...extra });
    const admit = { model: 'league_admit', params: { joinDecreeId: DECREE } };
    expect(lapsed(admit, { reason: 'league_full' })).toBe(true);
    expect(lapsed(admit, { reason: 'model_closed' })).toBe(true);
    expect(lapsed(admit, { reason: 'uncovered', capOboles: 0 })).toBe(false);
    const works = { model: 'public_works', params: { amountOboles: 600 } };
    expect(lapsed(works, { reason: 'league_full' })).toBe(false);
    expect(lapsed({ model: 'ostracism', params: {} }, { reason: 'model_closed' })).toBe(false);
  });

  it('événements : fondation, entrée, sortie ; une ligue dissoute n’a plus d’hégémon', () => {
    const base = { leagueId: LEAGUE, name: 'Ligue de Délos', decreeId: DECREE, cityId: CITY };
    expect(event('LeagueFounded', base)).toBe(true);
    expect(event('LeagueFounded', { ...base, name: '' })).toBe(false);
    const joined = { ...base, cityId: OTHER, requestDecreeId: DECREE, hegemonCityId: CITY };
    expect(event('LeagueJoined', joined)).toBe(true);
    expect(event('LeagueJoined', { ...joined, hegemonCityId: undefined })).toBe(false);
    const left = (extra: object) => event('LeagueLeft', { ...base, ...extra });
    expect(left({ reason: 'left', hegemonCityId: OTHER, dissolved: false })).toBe(true);
    expect(left({ reason: 'left', hegemonCityId: null, dissolved: true })).toBe(true);
    expect(left({ reason: 'dissolved', hegemonCityId: null, dissolved: true })).toBe(true);
    expect(left({ reason: 'dissolved', hegemonCityId: OTHER, dissolved: false })).toBe(false);
    expect(left({ reason: 'left', hegemonCityId: null, dissolved: false })).toBe(false);
    expect(left({ reason: 'left', hegemonCityId: OTHER, dissolved: true })).toBe(false);
  });
});
