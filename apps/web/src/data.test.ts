// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Client Supabase simulé dont chaque lecture attend qu'on lui réponde : on choisit l'ordre des réponses.
const reads = vi.hoisted(() => [] as { filter: string; answer: (rows: unknown[]) => void }[]);
vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      let filter = '';
      const query: Record<string, unknown> = {
        eq: (column: string, value: string) => ((filter += `${column}=${value}`), query),
        neq: (column: string, value: string) => ((filter += `${column}<>${value}`), query),
        gt: (column: string, value: string) => ((filter += `${column}>${value}`), query),
        then: (ok: (v: unknown) => unknown) =>
          new Promise((resolve) => {
            reads.push({ filter, answer: (rows) => resolve(ok({ data: rows })) });
          }),
      };
      for (const step of ['select', 'order', 'limit']) query[step] = () => query;
      return query;
    },
  },
}));
const { useRows } = await import('./data');

describe('useRows : une lecture d’un ancien filtre ne prend pas la place du filtre courant (#441, #456)', () => {
  it('un `reload` gardé sous l’ancien filtre relit le filtre courant, jamais l’ancien', async () => {
    const { result, rerender } = renderHook(
      ({ city }) => useRows<{ id: string }>('v', 'id', 'id', { city_id: city }),
      { initialProps: { city: 'c1' } },
    );
    await act(async () => reads[0]?.answer([{ id: 'a' }]));
    expect(result.current.rows).toEqual([{ id: 'a' }]);
    const stale = result.current.reload;
    rerender({ city: 'c2' });
    expect(result.current.rows).toBeNull();
    expect(reads.map((read) => read.filter)).toEqual(['city_id=c1', 'city_id=c2']);
    // Une minuterie ou une relecture lancée d'un rendu d'avant le changement de filtre : elle relit le filtre
    // courant (jamais l'ancien), et rend ses lignes.
    let staleRows: unknown = 'pending';
    await act(async () => void stale().then((rows) => (staleRows = rows)));
    expect(reads.map((read) => read.filter)).toEqual(['city_id=c1', 'city_id=c2', 'city_id=c2']);
    // La lecture remplacée ne compte plus ; seule la dernière, celle du filtre courant, est retenue.
    await act(async () => reads[1]?.answer([{ id: 'stale' }]));
    expect(result.current.rows).toBeNull();
    await act(async () => reads[2]?.answer([{ id: 'b' }]));
    expect(staleRows).toEqual([{ id: 'b' }]);
    expect(result.current.rows).toEqual([{ id: 'b' }]);
    expect(result.current.failed).toBe(false);
  });
});

describe('useRows : filtres', () => {
  it('égalité, autre valeur que, strictement après', async () => {
    reads.length = 0;
    renderHook(() =>
      useRows('v', 'id', 'id', { city_id: 'c1', house_id: { neq: 'h1' }, at: { gt: 't0' } }),
    );
    await act(async () => reads[0]?.answer([]));
    expect(reads.map((read) => read.filter)).toEqual(['city_id=c1house_id<>h1at>t0']);
  });
});
