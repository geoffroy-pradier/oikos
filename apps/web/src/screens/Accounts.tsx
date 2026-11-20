import {
  Button,
  Coins,
  EmptyState,
  KeyRound,
  Package,
  Scale,
  StatCard,
  StatGrid,
  TriangleAlert,
} from '@oikos/ui';
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
import { HouseNav } from '../HouseNav';
import { formatMoney } from '../money';
import { ScreenHeader } from '../ScreenHeader';
import { CashFlows } from './CashFlows';
import { IncomeStatement, type IncomeView } from './IncomeStatement';
import { Loading } from './LoadProblem';
import { ValuedStocks } from './ValuedStocks';

/** Lignes du bilan, chacune en carte ; le total, calculé à l'affichage, est mis en avant. */
const BALANCE = [
  ['treasury', <Coins key="treasury" />],
  ['escrow', <KeyRound key="escrow" />],
  ['stockValue', <Package key="stockValue" />],
  ['total', <Scale key="total" />],
] as const;

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
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <ScreenHeader title={t('accounts.title', { name: house.name })} titleRef={title} />
      <HouseNav />
      {failed ? (
        <EmptyState
          icon={<TriangleAlert />}
          title={<span role="alert">{t('app.loadFailed')}</span>}
          action={<Button onClick={retry}>{t('app.retry')}</Button>}
        />
      ) : (
        !(sheet && stocks) && <Loading />
      )}

      {sheet && (
        <section aria-labelledby="balance-sheet" className="flex flex-col gap-2">
          <h2 id="balance-sheet" className="text-lg font-semibold">
            {t('accounts.balanceSheet')}
          </h2>
          <StatGrid as="ul">
            {BALANCE.map(([line, icon]) => (
              // À 1 280 px, la grille a quatre colonnes : trésorerie et séquestre prennent deux colonnes chacun, stocks et
              // total aussi, de quoi remplir deux rangées sans trou.
              <li
                key={line}
                className={line === 'stockValue' || line === 'total' ? 'xl:col-span-2' : undefined}
              >
                <StatCard
                  wide={line === 'treasury'}
                  className={line === 'total' ? 'border-primary/40 bg-primary-subtle' : undefined}
                  label={t(`accounts.${line}`)}
                  icon={icon}
                  value={money(sheet[line])}
                  hint={
                    line === 'stockValue' && sheet.unpricedStocks > 0
                      ? t('accounts.unpriced', { count: sheet.unpricedStocks })
                      : undefined
                  }
                />
              </li>
            ))}
          </StatGrid>
        </section>
      )}
      {stocks && <ValuedStocks stocks={stocks} />}
      <IncomeStatement rows={incomeRows.failed ? null : income} view={view} onView={setView} />
      <CashFlows />
    </div>
  );
}
