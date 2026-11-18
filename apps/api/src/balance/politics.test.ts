import { describe, expect, it } from 'vitest';
import { adoptedBy, ballotOf, winnerOf } from './politics';

// Règles de vote de la stratégie d'archonte du banc (#282) : fonctions pures, sans base.
describe('ballotOf', () => {
  const candidates = [
    { houseId: 'a', sites: 3 },
    { houseId: 'b', sites: 4 },
    { houseId: 'c', sites: 4 },
  ];

  it('un candidat vote pour lui-même', () => {
    expect(ballotOf({ houseId: 'a' }, candidates).houseId).toBe('a');
  });

  it('un autre citoyen vote pour la maison qui a le plus de sites, la plus ancienne à égalité', () => {
    expect(ballotOf({ houseId: 'z' }, candidates).houseId).toBe('b');
  });
});

describe('winnerOf', () => {
  it('rend le candidat qui a le plus de bulletins, le plus ancien à égalité', () => {
    const candidate = (houseId: string, votes: number) => ({
      houseId,
      candidacyId: houseId,
      votes,
    });
    expect(winnerOf([candidate('a', 2), candidate('b', 5), candidate('c', 5)]).houseId).toBe('b');
    expect(winnerOf([candidate('a', 0), candidate('b', 0)]).houseId).toBe('a');
  });
});

describe('adoptedBy', () => {
  it('exige le quorum de l’électorat et strictement plus de voix pour que contre', () => {
    // Quorum de 20 % de 10 citoyens : deux votants suffisent.
    expect(adoptedBy({ for: 2, against: 0 }, 10, 2000)).toBe(true);
    expect(adoptedBy({ for: 1, against: 0 }, 10, 2000)).toBe(false);
    expect(adoptedBy({ for: 2, against: 2 }, 10, 2000)).toBe(false);
    expect(adoptedBy({ for: 3, against: 2 }, 10, 2000)).toBe(true);
  });

  it('une cité sans citoyen n’adopte rien : le quorum est atteint, mais aucune voix ne l’emporte', () => {
    expect(adoptedBy({ for: 0, against: 0 }, 0, 2000)).toBe(false);
  });
});
