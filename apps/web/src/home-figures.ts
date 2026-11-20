import { gameDayAt } from '@oikos/sim';
import { INCOME_COLUMNS, parseBalanceSheet, parseIncomeStatement } from './accounts';
import { balanceHistory } from './balance-history';
import { parseCashFlowDays } from './cash-flows';
import { useClockRules, useRows } from './data';
import { useGameTime } from './game-time';
import { useHouse } from './house';

/** Jours de jeu de la courbe de la trésorerie : un choix d'affichage. */
export const HISTORY_DAYS = 14;

/**
 * Lectures des chiffres clés du tableau de bord (4.1) : flux de la trésorerie des derniers jours de jeu, compte de
 * résultat du jour en cours et bilan. Sans horloge du monde, aucun jour n'est daté : ni courbe, ni résultat du jour.
 */
export function useHomeFigures(balance: number | undefined) {
  const house = useHouse();
  const now = useGameTime();
  const clock = useClockRules().rules?.clock;
  const today = dayOf(now, clock);
  const flowRows = useRows<unknown>(
    'my_cash_flows',
    'house_id, account, game_day, nature, amount',
    'game_day',
    today === null
      ? null
      : { house_id: house.id, account: 'treasury', game_day: { gt: String(today - HISTORY_DAYS) } },
  );
  const incomeRows = useRows<unknown>(
    'my_income_statement',
    `game_day, ${INCOME_COLUMNS.join(', ')}`,
    'game_day',
    today === null ? null : { house_id: house.id, game_day: String(today) },
  );
  const sheetRows = useRows<unknown>(
    'my_balance_sheet',
    'treasury, escrow, stock_value, unpriced_stocks',
    'house_id',
    { house_id: house.id },
  );
  // `undefined` : pas encore lu ; `null` : illisible.
  const days = flowRows.rows ? parseCashFlowDays(flowRows.rows, house.id) : undefined;
  const income = incomeRows.rows ? parseIncomeStatement(incomeRows.rows) : undefined;
  const sheet = sheetRows.rows ? parseBalanceSheet(sheetRows.rows[0]) : undefined;
  const reads = [flowRows, incomeRows, sheetRows];
  return {
    history:
      days && today !== null && balance !== undefined
        ? balanceHistory(balance, days, today, HISTORY_DAYS)
        : null,
    // Aucune ligne pour le jour en cours : rien n'a bougé, le résultat est nul.
    today: income ? (income[0] ?? null) : undefined,
    sheet,
    failed: reads.some((read) => read.failed) || [days, income, sheet].includes(null),
    reload: () => Promise.all(reads.map((read) => read.reload())),
  };
}

/** Jour de jeu en cours, si l'horloge du monde est connue et que le navigateur sait lire son fuseau. */
function dayOf(now: Date, clock: Parameters<typeof gameDayAt>[1] | null | undefined) {
  if (!clock) return null;
  try {
    return gameDayAt(now, clock);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
