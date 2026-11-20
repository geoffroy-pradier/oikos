// @vitest-environment jsdom
import { gameDayAt } from '@oikos/sim';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { variation } from './balance-history';
import { HouseProvider } from './house';

// Jour de jeu en cours et lectures du tableau de bord : 600 oboles en trésorerie, deux jours de flux.
const NOW = new Date('2026-06-10T12:00:00Z');
const CLOCK = { dailyCloseHour: 3, timezone: 'Europe/Athens' };
const TODAY = gameDayAt(NOW, CLOCK);
const flow = (day: number, nature: string, amount: number) => ({
  house_id: 'h1',
  account: 'treasury',
  game_day: day,
  nature,
  amount,
});
const zero = { purchases: 0, taxes: 0, acquisitions: 0, grants: 0, other: 0, non_operating: 0 };
const views: Record<string, object[]> = {
  my_cash_flows: [
    flow(TODAY - 9, 'sales', 120),
    flow(TODAY, 'sales', 48),
    flow(TODAY, 'escrow', -6),
  ],
  my_income_statement: [
    {
      game_day: TODAY,
      ...zero,
      sales: 48,
      upkeep: -30,
      operating_result: 18,
      cash_change: 18,
      escrow_change: 0,
    },
  ],
  my_balance_sheet: [{ treasury: 600, escrow: 0, stock_value: 240, unpriced_stocks: 2 }],
};
const state = vi.hoisted(() => ({ filters: {} as Record<string, unknown>, clock: true }));
vi.mock('./data', () => ({
  useRows: (view: string, _columns: string, _order: string, filter: unknown) => {
    state.filters[view] = filter;
    return { rows: filter === null ? null : (views[view] ?? []), failed: false, reload: vi.fn() };
  },
  useClockRules: () => ({ rules: state.clock ? { clock: CLOCK } : null }),
}));
vi.mock('./game-time', () => ({ useGameTime: () => NOW }));
const { useHomeFigures } = await import('./home-figures');

let figures: ReturnType<typeof useHomeFigures> | undefined;
function Probe() {
  figures = useHomeFigures(600);
  return null;
}
function show() {
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  render(
    <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
      <Probe />
    </HouseProvider>,
  );
  return figures;
}
afterEach(cleanup);

describe('lectures des chiffres clés', () => {
  it('flux des 14 derniers jours de jeu, résultat du jour en cours, bilan', () => {
    const read = show();
    expect(state.filters['my_cash_flows']).toEqual({
      house_id: 'h1',
      account: 'treasury',
      game_day: { gt: String(TODAY - 14) },
    });
    expect(state.filters['my_income_statement']).toEqual({
      house_id: 'h1',
      game_day: String(TODAY),
    });
    // Quatorze soldes de fin de jour ; le flux d'il y a neuf jours sort de la semaine, pas de la courbe.
    expect(read?.history).toHaveLength(14);
    expect(read?.history?.[0]?.balance).toBe(600 - 42 - 120);
    expect(read?.history && variation(read.history, 7)).toBe(42);
    expect(read?.today?.operating_result).toBe(18);
    expect(read?.sheet?.stockValue).toBe(240);
    expect(read?.failed).toBe(false);
  });

  it('sans horloge du monde : ni courbe ni résultat du jour, rien de lu pour eux, aucun échec', () => {
    state.clock = false;
    const read = show();
    expect(state.filters['my_cash_flows']).toBeNull();
    expect(read?.history).toBeNull();
    expect(read?.today).toBeUndefined();
    expect(read?.failed).toBe(false);
    state.clock = true;
  });
});
