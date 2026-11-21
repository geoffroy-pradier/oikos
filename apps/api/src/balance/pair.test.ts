import { describe, expect, it } from 'vitest';
import { playPair } from './pair';

const later = <T>(value: T, ms: number) =>
  new Promise<T>((resolve) => setTimeout(resolve, ms, value));

describe('playPair', () => {
  it('starts both games before either ends, and returns what each returned', async () => {
    const events: string[] = [];
    const game = (name: string, ms: number) => async () => {
      events.push(`start ${name}`);
      const value = await later({ name }, ms);
      events.push(`end ${name}`);
      return value;
    };
    const pair = await playPair({
      reference: game('reference', 20),
      candidate: game('candidate', 5),
    });
    expect(pair).toEqual({ reference: { name: 'reference' }, candidate: { name: 'candidate' } });
    expect(events.slice(0, 2)).toEqual(['start reference', 'start candidate']);
  });

  it('gives the same report as playing one after the other, for the same seed', async () => {
    const play = (seed: string, tag: string) => async () => ({
      tag,
      seed,
      value: seed.length * tag.length,
    });
    const sequential = {
      reference: await play('s'.repeat(16), 'ref')(),
      candidate: await play('s'.repeat(16), 'cand')(),
    };
    expect(
      await playPair({
        reference: play('s'.repeat(16), 'ref'),
        candidate: play('s'.repeat(16), 'cand'),
      }),
    ).toEqual(sequential);
  });

  it('waits for the other game, then raises the first error', async () => {
    let ended = false;
    const failing = playPair({
      reference: () => Promise.reject(new Error('reference failed')),
      candidate: async () => {
        await later(null, 20);
        ended = true;
        return 1;
      },
    });
    await expect(failing).rejects.toThrow('reference failed');
    expect(ended).toBe(true);
  });
});
