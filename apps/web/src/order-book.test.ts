import { describe, expect, it } from 'vitest';
import { bestOpposite } from './order-book';

describe('bestOpposite', () => {
  const bids = [
    { price: 17, quantity: 40 },
    { price: 15, quantity: 25 },
  ];
  it('rend le premier niveau, pour toute sa quantité, sans ordre de la maison', () => {
    expect(bestOpposite(bids, [])).toEqual({ price: 17, quantity: 40 });
  });
  it('retire les ordres de la maison du niveau, et passe un niveau qui n’est fait que des siens', () => {
    expect(bestOpposite(bids, [{ price: 17, remaining: 10 }])).toEqual({ price: 17, quantity: 30 });
    const own = [
      { price: 17, remaining: 30 },
      { price: 17, remaining: 10 },
    ];
    expect(bestOpposite(bids, own)).toEqual({ price: 15, quantity: 25 });
  });
  it('rend null pour un carnet vide ou fait des seuls ordres de la maison', () => {
    expect(bestOpposite([], [])).toBeNull();
    expect(bestOpposite([{ price: 9, quantity: 5 }], [{ price: 9, remaining: 5 }])).toBeNull();
  });
});
