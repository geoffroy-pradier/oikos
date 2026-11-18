import { describe, expect, it } from 'vitest';
import { parseCashFlowDays } from './cash-flows';

const row = (game_day: number | null, nature: string, amount: number, account = 'treasury') => ({
  house_id: 'h1',
  account,
  game_day,
  nature,
  amount,
});

describe('flux de trésorerie de la maison (#272)', () => {
  it('par jour, du plus récent au plus ancien, natures dans leur ordre, nature inconnue en fin, net du jour', () => {
    const days = parseCashFlowDays(
      [
        row(20406, 'offerings', -60),
        row(20406, 'future_nature', 5),
        row(20406, 'sales', 120),
        row(20406, 'escrow', 30, 'escrow'),
        { ...row(20406, 'sales', 999), house_id: 'h2' },
        row(20405, 'grant', 6000),
        row(null, 'other', 1),
      ],
      'h1',
    );
    expect(days).toEqual([
      {
        day: 20406,
        net: 65,
        flows: [
          { nature: 'sales', amount: 120 },
          { nature: 'offerings', amount: -60 },
          { nature: 'future_nature', amount: 5 },
        ],
      },
      { day: 20405, net: 6000, flows: [{ nature: 'grant', amount: 6000 }] },
      { day: null, net: 1, flows: [{ nature: 'other', amount: 1 }] },
    ]);
  });

  it('une ligne illisible ou un net hors des entiers sûrs : null, jamais « aucun mouvement »', () => {
    expect(parseCashFlowDays([row(1, 'sales', 1.5)], 'h1')).toBeNull();
    const big = Number.MAX_SAFE_INTEGER;
    expect(parseCashFlowDays([row(1, 'sales', big), row(1, 'grant', big)], 'h1')).toBeNull();
  });
});
