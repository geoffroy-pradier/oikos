import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ostracismOutcome } from './ostracism';

describe('issue d’un ostracisme (6.4 ; #722)', () => {
  // Bulletins par maison nommée, citoyens, quorum ; puis issue et maison ostracisée.
  it.each([
    [{ a: 3, b: 1 }, 10, 3000, 'ostracized', 'a'], // 4 sur 10 : quorum atteint, A seule en tête
    [{ a: 2, b: 0 }, 10, 3000, 'no_quorum', null], // 2 sur 10 : 20 % < 30 %
    [{ a: 3 }, 10, 3000, 'ostracized', 'a'], // 3 sur 10 : exactement 30 %
    [{ a: 2, b: 2 }, 10, 3000, 'tie', null], // égalité en tête : personne
    [{ a: 2, b: 2, c: 3 }, 10, 3000, 'ostracized', 'c'], // une égalité derrière la tête ne compte pas
    [{}, 0, 10_000, 'tie', null], // aucun citoyen : quorum trivial, aucun nom
    [{}, 5, 0, 'tie', null], // quorum nul, aucun bulletin
    [{ a: 1 }, 1, 10_000, 'ostracized', 'a'],
  ] as const)(
    'exemple %o, %i citoyens, quorum %i',
    (ostraca, electorate, quorumBps, outcome, houseId) => {
      const decision = ostracismOutcome({ ostraca, electorate, quorumBps });
      expect([decision.outcome, decision.houseId]).toEqual([outcome, houseId]);
      expect(() => ostracismOutcome({ ostraca: { a: -1 }, electorate, quorumBps })).toThrow(
        RangeError,
      );
      expect(() => ostracismOutcome({ ostraca, electorate, quorumBps: 10_001 })).toThrow(
        RangeError,
      );
    },
  );

  it('propriétés : ostracisée seulement seule en tête et avec quorum ; un bulletin de plus pour elle ne la sauve pas', () => {
    const counts = fc.record({
      ostraca: fc.dictionary(fc.constantFrom('a', 'b', 'c', 'd'), fc.integer({ min: 0, max: 50 })),
      abstained: fc.integer({ min: 0, max: 200 }),
      quorumBps: fc.oneof(
        fc.constantFrom(0, 1, 9_999, 10_000),
        fc.integer({ min: 0, max: 10_000 }),
      ),
    });
    fc.assert(
      fc.property(counts, ({ ostraca, abstained, quorumBps }) => {
        const votes = Object.values(ostraca);
        const ballots = votes.reduce((sum, value) => sum + value, 0);
        const electorate = ballots + abstained;
        const decision = ostracismOutcome({ ostraca, electorate, quorumBps });
        expect(decision.ballots).toBe(ballots);
        expect(decision.quorumReached).toBe(ballots * 10_000 >= quorumBps * electorate);
        const top = Math.max(0, ...votes);
        const leaders = Object.keys(ostraca).filter((house) => ostraca[house] === top);
        const alone = top > 0 && leaders.length === 1;
        expect(decision.outcome).toBe(
          !decision.quorumReached ? 'no_quorum' : alone ? 'ostracized' : 'tie',
        );
        if (decision.outcome !== 'ostracized') return;
        expect(decision.votes).toBe(top);
        // Un bulletin de plus pour la maison ostracisée, pris aux abstentions, ne change pas l'issue.
        if (abstained > 0) {
          const more = { ...ostraca, [decision.houseId]: top + 1 };
          expect(ostracismOutcome({ ostraca: more, electorate, quorumBps }).houseId).toBe(
            decision.houseId,
          );
        }
      }),
    );
  });
});
