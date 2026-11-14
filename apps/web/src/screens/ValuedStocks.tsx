import { Card } from '@oikos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sortRows, type ValuedStock } from '../accounts';
import { formatMoney } from '../money';

const COLUMNS = ['good', 'quantity', 'unitPrice', 'value'] as const;
type Column = (typeof COLUMNS)[number];

/**
 * Stocks valorisés de la maison (4.1) : fiches empilées sur téléphone, tableau triable sur ordinateur,
 * mêmes valeurs dans le même ordre. Le tri se change au clavier par les boutons d'en-tête ; la colonne
 * triée porte `aria-sort` et une flèche, et chaque changement de tri est annoncé (`role="status"`). Un
 * stock sans prix observé est dit tel, jamais valorisé à zéro.
 */
export function ValuedStocks({ stocks }: { stocks: ValuedStock[] }) {
  const { t, i18n } = useTranslation();
  // Par défaut, les stocks de plus forte valeur d'abord ; ceux qui n'ont pas de prix à la fin.
  const [sort, setSort] = useState<{ column: Column; descending: boolean; changed?: true }>({
    column: 'value',
    descending: true,
  });
  const money = (amount: number) => formatMoney(amount, t, i18n.language);
  const number = new Intl.NumberFormat(i18n.language);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const goodName = (stock: ValuedStock) =>
    t(`goods.${stock.goodId}`, { defaultValue: stock.goodId });
  const keys: Record<Column, (stock: ValuedStock) => number | string | null> = {
    good: goodName,
    quantity: (stock) => stock.quantity,
    unitPrice: (stock) => stock.unitPrice,
    value: (stock) => stock.value,
  };
  const sorted = sortRows(stocks, keys[sort.column], sort.descending, i18n.language);
  const cells = (stock: ValuedStock) => ({
    quantity: number.format(stock.quantity),
    unitPrice:
      stock.unitPrice === null || stock.pricedAt === null
        ? t('accounts.noPrice')
        : t('accounts.priceAt', {
            price: money(stock.unitPrice),
            date: date.format(stock.pricedAt),
          }),
    value: stock.value === null ? t('accounts.notValued') : money(stock.value),
  });
  const details = COLUMNS.filter((column) => column !== 'good');
  const id = (stock: ValuedStock) => `${stock.cityId} ${stock.goodId}`;

  return (
    <Card className="flex flex-col gap-3" aria-labelledby="valued-stocks">
      <h2 id="valued-stocks" className="text-xl">
        {t('accounts.stocks')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('accounts.stocksIntro')}</p>
      {stocks.length === 0 && <p>{t('accounts.stocksEmpty')}</p>}
      {stocks.length > 0 && (
        <>
          <ul className="flex flex-col gap-3 lg:hidden">
            {sorted.map((stock) => (
              <li key={id(stock)} className="rounded-md border border-border p-3">
                <h3 className="text-lg">{goodName(stock)}</h3>
                <dl>
                  {details.map((column) => (
                    <div
                      key={column}
                      className="flex flex-wrap items-baseline justify-between gap-x-4"
                    >
                      <dt>{t(`accounts.${column}`)}</dt>
                      <dd>{cells(stock)[column]}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          {/* Le tri changé est annoncé aux lecteurs d'écran ; absent à 360 px, où rien ne se trie. */}
          <p role="status" className="sr-only max-lg:hidden">
            {sort.changed &&
              t(sort.descending ? 'accounts.sortedDescending' : 'accounts.sortedAscending', {
                column: t(`accounts.${sort.column}`),
              })}
          </p>
          <table className="hidden w-full text-left lg:table">
            <caption className="sr-only">{t('accounts.stocks')}</caption>
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const direction = sort.descending ? 'descending' : 'ascending';
                  const sortedBy = sort.column === column;
                  return (
                    <th key={column} scope="col" {...(sortedBy && { 'aria-sort': direction })}>
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center gap-1 font-semibold"
                        // Même colonne : sens inverse. Autre colonne : noms de A à Z, nombres du plus grand au plus petit.
                        onClick={() =>
                          setSort({
                            column,
                            descending: sortedBy ? !sort.descending : column !== 'good',
                            changed: true,
                          })
                        }
                      >
                        {t(`accounts.${column}`)}
                        {sortedBy && <span aria-hidden="true">{sort.descending ? '▼' : '▲'}</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((stock) => (
                <tr key={id(stock)} className="border-t border-border">
                  <th scope="row" className="py-2 pr-3 font-normal">
                    {goodName(stock)}
                  </th>
                  {details.map((column) => (
                    <td key={column} className="py-2 pr-3">
                      {cells(stock)[column]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}
