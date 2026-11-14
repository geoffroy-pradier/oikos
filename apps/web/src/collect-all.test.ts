import { describe, expect, it } from 'vitest';
import type { CommandResponse } from './api';
import { collectAll, type Stack } from './collect-all';

const ok = (outputs: Stack[]): CommandResponse<{ outputs: Stack[] }> => ({
  ok: true,
  data: { outputs },
  replayed: false,
});
const refused = (code: string): CommandResponse<{ outputs: Stack[] }> => ({
  ok: false,
  error: { code, message: code },
});

describe('collectAll', () => {
  it('une commande par site, dans l’ordre, l’une après l’autre', async () => {
    const calls: string[] = [];
    let running = 0;
    await collectAll(['a', 'b', 'c'], async (siteId) => {
      running += 1;
      expect(running).toBe(1);
      calls.push(siteId);
      await Promise.resolve();
      running -= 1;
      return ok([]);
    });
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('additionne les récoltes réussies par bien', async () => {
    const outputs: Record<string, Stack[]> = {
      a: [{ goodId: 'wheat', quantity: 40 }],
      b: [
        { goodId: 'wheat', quantity: 10 },
        { goodId: 'olives', quantity: 5 },
      ],
    };
    const outcome = await collectAll(['a', 'b'], async (siteId) => ok(outputs[siteId] ?? []));
    expect(outcome).toEqual({
      collected: [
        { goodId: 'wheat', quantity: 50 },
        { goodId: 'olives', quantity: 5 },
      ],
      succeeded: ['a', 'b'],
      failed: [],
    });
  });

  it('un échec n’arrête pas les suivantes et garde son site et son code', async () => {
    const outcome = await collectAll(['a', 'b', 'c'], async (siteId) =>
      siteId === 'b' ? refused('MISSING_INPUTS') : ok([{ goodId: 'wheat', quantity: 1 }]),
    );
    expect(outcome.succeeded).toEqual(['a', 'c']);
    expect(outcome.failed).toEqual([{ siteId: 'b', code: 'MISSING_INPUTS' }]);
    expect(outcome.collected).toEqual([{ goodId: 'wheat', quantity: 2 }]);
  });

  it('aucun site : aucune commande', async () => {
    let calls = 0;
    const outcome = await collectAll([], async () => {
      calls += 1;
      return ok([]);
    });
    expect(calls).toBe(0);
    expect(outcome).toEqual({ collected: [], succeeded: [], failed: [] });
  });
});
