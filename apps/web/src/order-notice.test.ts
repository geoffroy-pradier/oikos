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

/** Taxe de marché de 5 %, lue par défaut ; `null` : elle n'a pas pu être lue. */
const TAX = { rateBps: 500, burnShareBps: 5000 };
const notice = (
  input: Parameters<typeof orderNotice>[0],
  result: ReturnType<typeof reply>,
  tax: typeof TAX | null = TAX,
) => orderNotice(input, result, tax);

describe('annonce après le dépôt d’un ordre', () => {
  it('vente : déposée, conclue, ou conclue en partie au prix des achats servis, taxe de marché déduite par échange', () => {
    const sell = { side: 'sell' as const, price: 6, quantity: 30 };
    expect(notice(sell, reply('open', 30))).toMatchObject({ key: 'placedSell', quantity: 30 });
    expect(
      notice(
        sell,
        reply('filled', 0, [
          { price: 9, quantity: 10 },
          { price: 7, quantity: 20 },
        ]),
      ),
    ).toEqual({ key: 'sold', quantity: 30, wanted: 30, amount: 85 + 133, held: 0 });
    expect(notice(sell, reply('open', 18, [{ price: 9, quantity: 12 }]))).toEqual({
      key: 'soldPartly',
      quantity: 12,
      wanted: 30,
      amount: 102,
      held: 0,
    });
    // Taxe illisible : le brut, annoncé comme tel, plutôt qu'un net inventé.
    const served = [{ price: 9, quantity: 12 }];
    expect(notice(sell, reply('filled', 0, served), null)).toMatchObject({
      key: 'soldGross',
      amount: 108,
    });
    expect(notice(sell, reply('open', 18, served), null)).toMatchObject({
      key: 'soldPartlyGross',
      amount: 108,
    });
    // L'acheteur, lui, paie le brut : la taxe est prélevée sur le vendeur.
    expect(notice({ ...sell, side: 'buy' }, reply('filled', 0, served))).toMatchObject({
      amount: 108,
    });
  });

  it('achat : en attente avec la somme retenue, conclu, partiel qui attend, ou partiel faute de fonds', () => {
    const buy = { side: 'buy' as const, price: 8, quantity: 30 };
    expect(notice(buy, reply('open', 30))).toEqual({
      key: 'placedBuy',
      quantity: 30,
      wanted: 30,
      amount: 0,
      held: 240,
    });
    expect(notice(buy, reply('filled', 0, [{ price: 6, quantity: 30 }]))).toMatchObject({
      key: 'bought',
      amount: 180,
      held: 0,
    });
    // Le reste attend à son prix limite, pas au prix des ventes déjà servies.
    expect(notice(buy, reply('open', 20, [{ price: 6, quantity: 10 }]))).toEqual({
      key: 'boughtPartly',
      quantity: 10,
      wanted: 30,
      amount: 60,
      held: 160,
    });
    expect(notice(buy, reply('cancelled', 20, [{ price: 6, quantity: 10 }]))).toMatchObject({
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
      'soldGross',
      'soldPartlyGross',
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
