import { Button, Card } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  INCOME_COLUMNS,
  parseBalanceSheet,
  parseIncomeStatement,
  parseValuedStocks,
} from '../accounts';
import { useRows } from '../data';
import { useHouse } from '../house';
import { formatMoney } from '../money';
import { CashFlows } from './CashFlows';
import { IncomeStatement, type IncomeView } from './IncomeStatement';
import { Loading } from './LoadProblem';
import { ValuedStocks } from './ValuedStocks';

/** Une ligne de libellé et de valeur ; la valeur passe sous le libellé quand la fiche est étroite. */
const LINE = 'flex flex-wrap items-baseline justify-between gap-x-4';

/**
 * Comptes de la maison (4.1) : bilan, stocks valorisés, compte de résultat et flux de trésorerie, lus
 * dans les vues du joueur, en drachmes et oboles. Une lecture en échec ou illisible est annoncée et se réessaie : elle
 * n'est jamais prise pour un bilan nul, un entrepôt vide ou une période sans mouvement.
 */
export function AccountsScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const mine = { house_id: house.id };
  const sheetRows = useRows<unknown>(
    'my_balance_sheet',
    'treasury, escrow, stock_value, unpriced_stocks',
    'house_id',
    mine,
  );
  const stockRows = useRows<unknown>(
    'my_valued_stocks',
    'city_id, good_id, quantity, unit_price, value, priced_at',
    'good_id',
    mine,
  );
  // Compte de résultat : les `limit` dernières périodes seulement, jamais tout l'historique.
  const [view, setView] = useState<IncomeView>({ grouping: 'day', limit: 7 });
  const bySeason = view.grouping === 'season';
  const incomeRows = useRows<unknown>(
    bySeason ? 'my_income_statement_by_season' : 'my_income_statement',
    `${bySeason ? 'first_game_day, last_game_day' : 'game_day'}, ${INCOME_COLUMNS.join(', ')}`,
    bySeason ? 'season' : 'game_day',
    mine,
    { limit: view.limit },
  );
  // `undefined` : pas encore lu ; `null` : illisible.
  const sheet = sheetRows.rows ? parseBalanceSheet(sheetRows.rows[0]) : undefined;
  const stocks = stockRows.rows ? parseValuedStocks(stockRows.rows) : undefined;
  const income = incomeRows.rows ? parseIncomeStatement(incomeRows.rows) : undefined;
  const failed =
    [sheetRows, stockRows, incomeRows].some((read) => read.failed) ||
    [sheet, stocks, income].includes(null);
  const retry = () =>
    void Promise.all([sheetRows.reload(), stockRows.reload(), incomeRows.reload()]);

  // Le foyer va au titre à l'arrivée sur l'écran (le lien suivi a disparu avec l'écran quitté), et y
  // revient quand « Réessayer » disparaît. Seulement s'il est perdu : un foyer que le joueur a posé
  // ailleurs pendant la lecture n'est pas repris.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!failed && document.activeElement === document.body) title.current?.focus();
  }, [failed]);

  const money = (amount: number) => formatMoney(amount, t, i18n.language);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 ref={title} tabIndex={-1} className="text-2xl">
          {t('accounts.title', { name: house.name })}
        </h1>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
        >
          {t('shell.backHome')}
        </Link>
      </Card>
      {failed ? (
        <Card className="flex flex-col items-start gap-2">
          <p role="alert">{t('app.loadFailed')}</p>
          <Button onClick={retry}>{t('app.retry')}</Button>
        </Card>
      ) : (
        !(sheet && stocks) && <Loading />
      )}

      {sheet && (
        <Card aria-labelledby="balance-sheet">
          <h2 id="balance-sheet" className="text-xl">
            {t('accounts.balanceSheet')}
          </h2>
          <dl>
            {(['treasury', 'escrow', 'stockValue', 'total'] as const).map((line) => (
              <div
                key={line}
                className={line === 'total' ? `${LINE} mt-2 border-t border-border pt-2` : LINE}
              >
                <dt>{t(`accounts.${line}`)}</dt>
                <dd className="font-semibold">{money(sheet[line])}</dd>
              </div>
            ))}
          </dl>
          {sheet.unpricedStocks > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('accounts.unpriced', { count: sheet.unpricedStocks })}
            </p>
          )}
        </Card>
      )}
      {stocks && <ValuedStocks stocks={stocks} />}
      <IncomeStatement rows={incomeRows.failed ? null : income} view={view} onView={setView} />
      <CashFlows />
    </div>
  );
}
