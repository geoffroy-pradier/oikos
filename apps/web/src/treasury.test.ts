import { describe, expect, it } from 'vitest';
import { parseCityRate, parseTreasuryBalance, parseTreasuryDays } from './treasury';

describe('trésor public de la cité (#264)', () => {
  it('solde de la cité ; aucune ligne : trésor vide ; ligne illisible : échec', () => {
    const rows = [
      { city_id: 'c1', balance: 1234 },
      { city_id: 'c2', balance: 9 },
    ];
    expect(parseTreasuryBalance(rows, 'c1')).toBe(1234);
    expect(parseTreasuryBalance([], 'c1')).toBe(0);
    expect(parseTreasuryBalance([{ city_id: 'c1', balance: 1.5 }], 'c1')).toBeNull();
  });

  it('flux par jour, du plus récent au plus ancien, natures dans leur ordre, net du jour', () => {
    const days = parseTreasuryDays(
      [
        { city_id: 'c1', game_day: 20000, nature: 'public_works', amount: -600 },
        { city_id: 'c1', game_day: 20000, nature: 'market_tax', amount: 51 },
        { city_id: 'c1', game_day: 20001, nature: 'other', amount: 4 },
        { city_id: 'c2', game_day: 20001, nature: 'port_dues', amount: 40 },
        { city_id: 'c1', game_day: null, nature: 'festival', amount: -3 },
      ],
      'c1',
    );
    expect(days?.map((day) => day.day)).toEqual([20001, 20000, null]);
    expect(days?.[1]).toEqual({
      day: 20000,
      flows: [
        { nature: 'market_tax', amount: 51 },
        { nature: 'public_works', amount: -600 },
      ],
      net: -549,
    });
    expect(
      parseTreasuryDays([{ city_id: 'c1', game_day: 1, nature: 'loot', amount: 1 }], 'c1'),
    ).toBeNull();
  });

  it('taux en vigueur de la cité ; ligne absente : inconnu', () => {
    const rows = [{ city_id: 'c1', market_tax_rate_bps: 800, port_dues_coefficient_bps: 15000 }];
    expect(parseCityRate(rows, 'c1')).toEqual({
      marketTaxRateBps: 800,
      portDuesCoefficientBps: 15000,
    });
    expect(parseCityRate(rows, 'c2')).toBeNull();
    expect(
      parseCityRate(
        [{ city_id: 'c1', market_tax_rate_bps: -1, port_dues_coefficient_bps: 1 }],
        'c1',
      ),
    ).toBeNull();
  });
});
