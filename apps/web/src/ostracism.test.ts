import { describe, expect, it } from 'vitest';
import {
  castAt,
  currentOstracism,
  filterCitizens,
  ostracismPhase,
  parseOstracismResults,
  parseOstracisms,
} from './ostracism';

const vote = (id: string, openedAt: string, extra = {}) => ({
  id,
  city_id: 'c1',
  opened_at: openedAt,
  voting_closes_at: '2026-11-23T04:00:00+00:00',
  quorum_bps: 2000,
  tallied_at: null,
  electorate: null,
  ballots: null,
  outcome: null,
  ostracized_house_id: null,
  ends_at: null,
  in_force: false,
  ...extra,
});
const CLOSES = Date.parse('2026-11-23T04:00:00+00:00');

describe('votes d’ostracisme', () => {
  it('lit les votes du plus récent au plus ancien, et refuse une ligne illisible', () => {
    const list = parseOstracisms([
      vote('old', '2026-10-01T04:00:00+00:00'),
      vote('new', '2026-11-21T04:00:00+00:00'),
    ]);
    expect(list?.map((entry) => entry.id)).toEqual(['new', 'old']);
    expect(parseOstracisms([vote('x', 'hier')])).toBeNull();
    expect(
      parseOstracisms([vote('x', '2026-11-21T04:00:00+00:00', { outcome: 'autre' })]),
    ).toBeNull();
  });

  it('le vote en cours passe avant le dernier dépouillé ; aucun vote : rien', () => {
    const tallied = vote('t', '2026-11-22T04:00:00+00:00', {
      tallied_at: '2026-11-22T05:00:00+00:00',
      outcome: 'tie',
    });
    const open = vote('o', '2026-10-01T04:00:00+00:00');
    expect(currentOstracism(parseOstracisms([tallied, open]) ?? [])?.id).toBe('o');
    expect(currentOstracism(parseOstracisms([tallied]) ?? [])?.id).toBe('t');
    expect(currentOstracism([])).toBeNull();
  });

  it('au vote jusqu’à sa clôture, puis en attente du dépouillement, puis dépouillé', () => {
    const [open] = parseOstracisms([vote('o', '2026-11-21T04:00:00+00:00')]) ?? [];
    expect(open && ostracismPhase(open, CLOSES - 1)).toBe('voting');
    expect(open && ostracismPhase(open, CLOSES)).toBe('counting');
    const [done] =
      parseOstracisms([
        vote('o', '2026-11-21T04:00:00+00:00', { tallied_at: '2026-11-23T05:00:00+00:00' }),
      ]) ?? [];
    expect(done && ostracismPhase(done, 0)).toBe('tallied');
  });
});

describe('décompte et bulletin', () => {
  it('décompte d’un vote, des plus nommées aux moins nommées', () => {
    const rows = [
      { ostracism_id: 'a', house_id: 'h1', ostraca: 1 },
      { ostracism_id: 'a', house_id: 'h2', ostraca: 4 },
      { ostracism_id: 'b', house_id: 'h3', ostraca: 9 },
    ];
    expect(parseOstracismResults(rows, 'a')).toEqual([
      { houseId: 'h2', votes: 4 },
      { houseId: 'h1', votes: 1 },
    ]);
    expect(parseOstracismResults([{ ostracism_id: 'a' }], 'a')).toBeNull();
  });

  it('la maison a voté ou non, sans jamais lire le nom inscrit', () => {
    const rows = [
      {
        ostracism_id: 'a',
        cast_at: '2026-11-22T10:00:00+00:00',
        house_id: 'h1',
        target_house_id: 'h9',
      },
    ];
    expect(castAt(rows, 'a')).toBe(Date.parse('2026-11-22T10:00:00+00:00'));
    expect(castAt(rows, 'b')).toBeNull();
    expect(castAt([{ ostracism_id: 'a' }], 'a')).toBeUndefined();
  });
});

describe('liste filtrable des citoyens', () => {
  const citizens = [{ name: 'Étéoboutades' }, { name: 'Alcméonides' }, { name: 'Philaïdes' }];

  it('sans casse ni accent, rangés par nom', () => {
    expect(filterCitizens(citizens, '').map((c) => c.name)).toEqual([
      'Alcméonides',
      'Étéoboutades',
      'Philaïdes',
    ]);
    expect(filterCitizens(citizens, 'ETEO').map((c) => c.name)).toEqual(['Étéoboutades']);
    expect(filterCitizens(citizens, '  ides ').map((c) => c.name)).toEqual([
      'Alcméonides',
      'Philaïdes',
    ]);
    expect(filterCitizens(citizens, 'zzz')).toEqual([]);
  });
});
