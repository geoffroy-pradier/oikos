import { Card, EmptyState, ScrollText } from '@oikos/ui';
import { gameDayDate } from '@oikos/sim';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { INCOME_COLUMNS, sortRows, type IncomeColumn, type IncomeRow } from '../accounts';
import { formatMoney } from '../money';
import { Loading } from './LoadProblem';

/** Ce que le joueur a choisi de lire : par jour ou par saison, et combien de périodes, les dernières. */
export interface IncomeView {
  grouping: 'day' | 'season';
  limit: number;
}
/** Choix du nombre de périodes lues : un confort de lecture, sous la limite de 1 000 lignes de l'API. */
const LIMITS = [7, 30, 90];
const CONTROL = 'min-h-11 rounded-md border border-border bg-surface px-3';

/**
 * Compte de résultat de la maison (4.1), par jour de jeu ou par saison : fiches empilées sur téléphone,
 * tableau triable sur ordinateur, périodes les plus récentes d'abord. Une période porte la date civile
 * de son jour de jeu (ou de son premier au dernier jour), jamais un rang ; sans horloge, elle est dite
 * inconnue. `rows` : `undefined` tant que rien n'est lu, `null` après un échec, annoncé par l'écran.
 */
export function IncomeStatement(props: {
  rows: IncomeRow[] | null | undefined;
  view: IncomeView;
  onView: (view: IncomeView) => void;
}) {
  const { rows, view, onView } = props;
  const { t, i18n } = useTranslation();
  type Sort = { column: 'period' | IncomeColumn; descending: boolean; changed?: true };
  const [sort, setSort] = useState<Sort>({ column: 'period', descending: true });
  const money = (amount: number) => formatMoney(amount, t, i18n.language);
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const period = (row: IncomeRow) =>
    row.firstDay === null || row.lastDay === null
      ? t('accounts.income.unknown')
      : dates.formatRange(gameDayDate(row.firstDay), gameDayDate(row.lastDay));
  const { column: by, descending } = sort;
  const sorted = sortRows(
    rows ?? [],
    (row) => (by === 'period' ? row.firstDay : row[by]),
    descending,
    i18n.language,
  );
  const label = (column: 'period' | IncomeColumn) =>
    t(`accounts.income.${column === 'period' ? view.grouping : column}`);

  return (
    <Card className="flex flex-col gap-3" aria-labelledby="income-statement">
      <h2 id="income-statement" className="text-xl">
        {t('accounts.income.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('accounts.income.intro')}</p>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('accounts.income.groupBy')}
          <select
            className={CONTROL}
            value={view.grouping}
            onChange={(event) =>
              onView({ ...view, grouping: event.target.value as 'day' | 'season' })
            }
          >
            {(['day', 'season'] as const).map((grouping) => (
              <option key={grouping} value={grouping}>
                {t(`accounts.income.${grouping}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('accounts.income.shown')}
          <select
            className={CONTROL}
            value={view.limit}
            onChange={(event) => onView({ ...view, limit: Number(event.target.value) })}
          >
            {LIMITS.map((limit) => (
              <option key={limit} value={limit}>
                {t('accounts.income.latest', { count: limit })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows === undefined && <Loading />}
      {rows?.length === 0 && (
        <EmptyState icon={<ScrollText />} title={t('accounts.income.empty')} headingLevel={3} />
      )}
      {sorted.length > 0 && (
        <>
          <ul className="flex flex-col gap-3 lg:hidden">
            {sorted.map((row) => (
              <li
                key={row.firstDay ?? 'unknown'}
                className="rounded-lg border border-border-subtle bg-surface-raised p-3 shadow-sm"
              >
                <h3 className="text-lg">{period(row)}</h3>
                <dl>
                  {INCOME_COLUMNS.map((column) => (
                    <div
                      key={column}
                      className="flex flex-wrap items-baseline justify-between gap-x-4"
                    >
                      <dt>{label(column)}</dt>
                      <dd>{money(row[column])}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          {/* Douze colonnes, montants gardés sur une ligne : le tableau défile dans sa carte. */}
          <div className="hidden overflow-x-auto lg:block">
            {/* Le tri changé est annoncé aux lecteurs d'écran, comme pour les stocks valorisés. */}
            <p role="status" className="sr-only">
              {sort.changed &&
                t(descending ? 'accounts.sortedDescending' : 'accounts.sortedAscending', {
                  column: label(by),
                })}
            </p>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('accounts.income.title')}</caption>
              <thead>
                <tr>
                  {(['period', ...INCOME_COLUMNS] as const).map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="pr-3 align-bottom"
                      {...(by === column && {
                        'aria-sort': descending ? 'descending' : 'ascending',
                      })}
                    >
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center gap-1 text-left font-semibold"
                        // Même colonne : sens inverse. Autre colonne : du plus récent ou du plus grand au plus petit.
                        onClick={() =>
                          setSort({
                            column,
                            descending: by !== column || !descending,
                            changed: true,
                          })
                        }
                      >
                        {label(column)}
                        {by === column && <span aria-hidden="true">{descending ? '▼' : '▲'}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.firstDay ?? 'unknown'} className="border-t border-border-subtle">
                    <th scope="row" className="py-2 pr-3 font-normal whitespace-nowrap">
                      {period(row)}
                    </th>
                    {INCOME_COLUMNS.map((column) => (
                      <td key={column} className="py-2 pr-3 whitespace-nowrap">
                        {money(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
