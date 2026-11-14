import { describe, expect, it } from 'vitest';
import { orderNotice } from './order-notice';
import en from './locales/en.json';
import fr from './locales/fr.json';

const ORDER = '00000000-0000-4000-8000-000000000001';
const reply = (
  status: 'open' | 'filled' | 'cancelled',
  remaining: number,
  trades: { price: number; quantity: number }[] = [],
) => ({ orderId: ORDER, status, remaining, trades });

describe('annonce après le dépôt d’un ordre', () => {
  it('vente : déposée, conclue, ou conclue en partie au prix des achats servis', () => {
    const sell = { side: 'sell' as const, price: 6, quantity: 30 };
    expect(orderNotice(sell, reply('open', 30))).toMatchObject({ key: 'placedSell', quantity: 30 });
    expect(
      orderNotice(
        sell,
        reply('filled', 0, [
          { price: 9, quantity: 10 },
          { price: 7, quantity: 20 },
        ]),
      ),
    ).toEqual({ key: 'sold', quantity: 30, wanted: 30, amount: 230, held: 0 });
    expect(orderNotice(sell, reply('open', 18, [{ price: 9, quantity: 12 }]))).toEqual({
      key: 'soldPartly',
      quantity: 12,
      wanted: 30,
      amount: 108,
      held: 0,
    });
  });

  it('achat : en attente avec la somme retenue, conclu, partiel qui attend, ou partiel faute de fonds', () => {
    const buy = { side: 'buy' as const, price: 8, quantity: 30 };
    expect(orderNotice(buy, reply('open', 30))).toEqual({
      key: 'placedBuy',
      quantity: 30,
      wanted: 30,
      amount: 0,
      held: 240,
    });
    expect(orderNotice(buy, reply('filled', 0, [{ price: 6, quantity: 30 }]))).toMatchObject({
      key: 'bought',
      amount: 180,
      held: 0,
    });
    // Le reste attend à son prix limite, pas au prix des ventes déjà servies.
    expect(orderNotice(buy, reply('open', 20, [{ price: 6, quantity: 10 }]))).toEqual({
      key: 'boughtPartly',
      quantity: 10,
      wanted: 30,
      amount: 60,
      held: 160,
    });
    expect(orderNotice(buy, reply('cancelled', 20, [{ price: 6, quantity: 10 }]))).toMatchObject({
      key: 'boughtShort',
      quantity: 10,
      held: 0,
    });
  });

  it('chaque annonce a son texte, en français et en anglais', () => {
    for (const key of [
      'placedSell',
      'sold',
      'soldPartly',
      'bought',
      'boughtShort',
      'boughtPartly',
      'placedBuy',
    ] as const) {
      expect(fr.agora[key]).toBeTruthy();
      expect(en.agora[key]).toBeTruthy();
    }
  });
});
