import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dailyCloseAt, gameDayAt } from './clock';
import { decreeOutcome, decreeSpendingCapOboles, decreeVotingClosesAt } from './decree';

const DAY_MS = 86_400_000;
const PARIS = { dailyCloseHour: 4, timezone: 'Europe/Paris' };

describe('issue d’un décret', () => {
  // Pour, contre, citoyens, quorum ; puis quorum atteint et adopté.
  it.each([
    [2, 1, 15, 2000, true, true],
    [2, 0, 15, 2000, false, false], // 2 sur 15 : 13,3 % < 20 %, malgré la majorité
    [2, 2, 15, 2000, true, false], // égalité : rejeté
    [3, 0, 15, 2000, true, true], // 3 sur 15 : exactement 20 %
    [0, 0, 0, 10_000, true, false], // aucun citoyen : quorum trivial, pas de majorité
    [1, 0, 1, 10_000, true, true],
  ] as const)('exemple %i pour, %i contre, %i citoyens, quorum %i', (...row) => {
    const [votesFor, votesAgainst, electorate, quorumBps, quorumReached, adopted] = row;
    const count = { votesFor, votesAgainst, electorate, quorumBps };
    expect(decreeOutcome(count)).toEqual({ quorumReached, adopted });
    expect(() => decreeOutcome({ ...count, votesFor: -1 })).toThrow(RangeError);
  });

  it('propriétés : adopté seulement avec quorum et majorité stricte ; un vote pour de plus n’en retire pas', () => {
    const counts = fc
      .record({
        votesFor: fc.integer({ min: 0, max: 5_000 }),
        votesAgainst: fc.integer({ min: 0, max: 5_000 }),
        abstained: fc.integer({ min: 0, max: 5_000 }),
        quorumBps: fc.oneof(
          fc.constantFrom(0, 1, 9_999, 10_000),
          fc.integer({ min: 0, max: 10_000 }),
        ),
      })
      .map(({ abstained, ...rest }) => ({
        ...rest,
        electorate: rest.votesFor + rest.votesAgainst + abstained,
      }));
    fc.assert(
      fc.property(counts, (count) => {
        const outcome = decreeOutcome(count);
        const cast = count.votesFor + count.votesAgainst;
        expect(outcome.quorumReached).toBe(cast * 10_000 >= count.quorumBps * count.electorate);
        expect(outcome.adopted).toBe(outcome.quorumReached && count.votesFor > count.votesAgainst);
        // Monotonie : un vote pour de plus, pris aux abstentions, ne fait jamais rejeter un décret adopté.
        if (count.electorate > cast && outcome.adopted)
          expect(decreeOutcome({ ...count, votesFor: count.votesFor + 1 }).adopted).toBe(true);
        // Tout le corps civique a voté : le quorum est toujours atteint.
        expect(decreeOutcome({ ...count, electorate: cast }).quorumReached).toBe(true);
      }),
    );
  });
});

describe('fin du vote d’un décret', () => {
  it('à la clôture du jour g + votingDays + 1 : au moins votingDays jours pleins, moins d’un de plus', () => {
    // Proposé le 16 novembre à 3 h 59 (jour de jeu du 15), juste avant la clôture : fin le 18 à 4 h.
    const before = new Date('2026-11-16T02:59:00Z');
    expect(decreeVotingClosesAt(before, 2, PARIS).toISOString()).toBe('2026-11-18T03:00:00.000Z');
    // Proposé juste après la clôture : fin le 19 à 4 h.
    const after = new Date('2026-11-16T03:01:00Z');
    expect(decreeVotingClosesAt(after, 2, PARIS).toISOString()).toBe('2026-11-19T03:00:00.000Z');
    expect(() => decreeVotingClosesAt(after, 0, PARIS)).toThrow(RangeError);
  });

  it('propriété : toujours une clôture, entre votingDays et votingDays + 1 jours après la proposition', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2030, 0, 1) }),
        fc.integer({ min: 1, max: 30 }),
        (time, votingDays) => {
          const proposedAt = new Date(time);
          const closesAt = decreeVotingClosesAt(proposedAt, votingDays, PARIS);
          expect(dailyCloseAt(gameDayAt(closesAt, PARIS), PARIS)).toEqual(closesAt);
          // Une heure de marge pour les changements d'heure.
          const elapsed = closesAt.getTime() - time;
          expect(elapsed).toBeGreaterThanOrEqual(votingDays * DAY_MS - 3_600_000);
          expect(elapsed).toBeLessThanOrEqual((votingDays + 1) * DAY_MS + 3_600_000);
        },
      ),
    );
  });
});

describe('plafond d’un décret de dépense', () => {
  it('part du trésor arrondie à l’obole inférieure, nulle pour un trésor vide', () => {
    expect(decreeSpendingCapOboles(1_000n, 2_500)).toBe(250n);
    expect(decreeSpendingCapOboles(1_003n, 2_500)).toBe(250n);
    expect(decreeSpendingCapOboles(3n, 2_500)).toBe(0n);
    expect(decreeSpendingCapOboles(0n, 10_000)).toBe(0n);
    expect(decreeSpendingCapOboles(-5n, 10_000)).toBe(0n);
    expect(decreeSpendingCapOboles(1_000n, 10_000)).toBe(1_000n);
    expect(() => decreeSpendingCapOboles(1_000n, 10_001)).toThrow(RangeError);
  });

  it('propriété : jamais plus que la part du trésor, ni plus que le trésor', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 62n }),
        fc.integer({ min: 0, max: 10_000 }),
        (treasury, share) => {
          const cap = decreeSpendingCapOboles(treasury, share);
          expect(cap * 10_000n <= treasury * BigInt(share)).toBe(true);
          expect((cap + 1n) * 10_000n > treasury * BigInt(share)).toBe(true);
          expect(cap <= treasury).toBe(true);
        },
      ),
    );
  });
});
