import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
const { unreadTotal } = await import('./chat-unread');

describe('pastille des non lus', () => {
  it('additionne les canaux, et reste un minimum si l’un des comptes en est un', () => {
    const counts = new Map([
      ['cite', { count: 3, atLeast: false }],
      ['prive', { count: 2, atLeast: false }],
    ]);
    expect(unreadTotal(counts)).toEqual({ count: 5, atLeast: false });
    counts.set('ancien', { count: 100, atLeast: true });
    expect(unreadTotal(counts)).toEqual({ count: 105, atLeast: true });
    expect(unreadTotal(new Map())).toEqual({ count: 0, atLeast: false });
  });
});
