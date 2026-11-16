import { describe, expect, it } from 'vitest';
import {
  currentElection,
  electionPhase,
  parseCandidates,
  parseElections,
  parseHouseNames,
  parseOffices,
  parseResults,
  parseVoted,
} from './politics';

const election = {
  id: 'e1',
  city_id: 'c1',
  office: 'archon',
  candidacy_opens_at: '2026-11-10T04:00:00+00:00',
  voting_opens_at: '2026-11-14T04:00:00+00:00',
  voting_closes_at: '2026-11-17T04:00:00+00:00',
  term_ends_at: '2026-12-08T04:00:00+00:00',
  tallied_at: null,
};
const ms = (iso: string) => Date.parse(iso);

describe('élections de la cité (#264)', () => {
  it('lit les élections, les plus récentes d’abord ; un instant illisible fait échouer la lecture', () => {
    const elections = parseElections([
      {
        ...election,
        id: 'old',
        candidacy_opens_at: '2026-10-13T04:00:00+00:00',
        tallied_at: '2026-10-20T04:00:00+00:00',
      },
      election,
    ]);
    expect(elections?.map((e) => e.id)).toEqual(['e1', 'old']);
    expect(elections?.[0]).toMatchObject({ office: 'archon', talliedAt: null });
    expect(elections?.[1]?.talliedAt).toBe(ms('2026-10-20T04:00:00+00:00'));
    expect(parseElections([{ ...election, voting_opens_at: 'demain' }])).toBeNull();
    expect(parseElections(null)).toBeNull();
  });

  it('phase : à venir, dépôt, vote, dépouillement attendu, dépouillée ; bornes comprises', () => {
    const [e] = parseElections([election]) ?? [];
    if (!e) throw new Error('lecture');
    expect(electionPhase(e, ms('2026-11-09T00:00:00Z'))).toBe('upcoming');
    expect(electionPhase(e, e.candidacyOpensAt)).toBe('filing');
    expect(electionPhase(e, e.votingOpensAt)).toBe('voting');
    expect(electionPhase(e, e.votingClosesAt - 1)).toBe('voting');
    expect(electionPhase(e, e.votingClosesAt)).toBe('counting');
    expect(electionPhase({ ...e, talliedAt: e.votingClosesAt }, e.votingClosesAt)).toBe('tallied');
  });

  it('élection en cours : la plus récente non dépouillée ; aucune si toutes le sont', () => {
    const elections =
      parseElections([
        election,
        { ...election, id: 'old', candidacy_opens_at: '2026-10-13T04:00:00+00:00' },
      ]) ?? [];
    expect(currentElection(elections)?.id).toBe('e1');
    const done = parseElections([{ ...election, tallied_at: '2026-11-17T04:00:00+00:00' }]) ?? [];
    expect(currentElection(done)).toBeNull();
  });

  it('candidatures, résultats triés (élu d’abord, puis par voix), charges et votes de la maison', () => {
    expect(
      parseCandidates([
        { id: 'k1', election_id: 'e1', house_id: 'h1', withdrawn_at: null },
        { id: 'k2', election_id: 'e1', house_id: 'h2', withdrawn_at: '2026-11-11T00:00:00Z' },
      ]),
    ).toEqual([
      { id: 'k1', electionId: 'e1', houseId: 'h1', withdrawn: false },
      { id: 'k2', electionId: 'e1', houseId: 'h2', withdrawn: true },
    ]);
    const results = parseResults([
      { election_id: 'e0', house_id: 'h2', votes: 4, elected: false },
      { election_id: 'e0', house_id: 'h3', votes: 1, elected: false },
      { election_id: 'e0', house_id: 'h1', votes: 3, elected: true },
    ]);
    expect(results?.map((r) => r.houseId)).toEqual(['h1', 'h2', 'h3']);
    expect(
      parseResults([{ election_id: 'e0', house_id: 'h1', votes: -1, elected: true }]),
    ).toBeNull();
    expect(
      parseOffices([
        { house_id: 'h1', office: 'archon', ends_at: '2026-12-08T04:00:00+00:00', in_office: true },
      ]),
    ).toEqual([
      { houseId: 'h1', office: 'archon', endsAt: ms('2026-12-08T04:00:00+00:00'), inOffice: true },
    ]);
    expect(parseVoted([{ election_id: 'e1' }], 'election_id')).toEqual(new Set(['e1']));
    expect(parseVoted([{ decree_id: 'd1' }], 'decree_id')).toEqual(new Set(['d1']));
    expect(parseVoted([{ election_id: 3 }], 'election_id')).toBeNull();
    expect(parseHouseNames([{ id: 'h1', name: 'Maison Alpha' }])?.get('h1')).toBe('Maison Alpha');
    expect(parseHouseNames([{ id: 'h1', name: '' }])).toBeNull();
  });
});
