import type { CashFlowDay } from './cash-flows';

/** Solde de la trésorerie à la fin d'un jour de jeu, et son mouvement net ce jour-là. */
export interface BalancePoint {
  day: number;
  balance: number;
  net: number;
}

/**
 * Solde de fin de chacun des `span` derniers jours de jeu, du plus ancien au jour en cours (`today`), retrouvé à
 * rebours depuis le solde lu (`balance`) et les flux nets de la trésorerie (`my_cash_flows`). Un jour sans flux
 * garde le solde de la veille ; un flux sans jour (aucune horloge en vigueur) n'est pas daté, il est ignoré.
 */
export function balanceHistory(
  balance: number,
  days: readonly CashFlowDay[],
  today: number,
  span: number,
): BalancePoint[] {
  const nets = new Map(days.map((day) => [day.day, day.net]));
  const points: BalancePoint[] = [];
  let end = balance;
  for (let day = today; day > today - span; day -= 1) {
    const net = nets.get(day) ?? 0;
    points.unshift({ day, balance: end, net });
    end -= net;
  }
  return points;
}

/** Variation de la trésorerie sur les `span` derniers jours d'un historique, jour en cours compris. */
export const variation = (points: readonly BalancePoint[], span: number) =>
  points.slice(-span).reduce((sum, point) => sum + point.net, 0);
