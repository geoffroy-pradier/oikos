import { Card, DataTable, EmptyState, Package, type DataColumn } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Help } from './Help';
import type { ValuedStock } from '../accounts';
import { formatMoney } from '../money';
import { dateTimeFormat } from '../game-time';

/**
 * Stocks valorisés de la maison (4.1) : tableau triable sur ordinateur, fiches empilées sur téléphone
 * (`DataTable`), mêmes valeurs dans le même ordre. Par défaut, les stocks de plus forte valeur d'abord ;
 * un stock sans prix observé est dit tel, jamais valorisé à zéro, et reste à la fin quel que soit le tri.
 */
export function ValuedStocks({ stocks }: { stocks: ValuedStock[] }) {
  const { t, i18n } = useTranslation();
  const money = (amount: number) => formatMoney(amount, t, i18n.language);
  const number = new Intl.NumberFormat(i18n.language);
  const date = dateTimeFormat(i18n.language);
  const goodName = (stock: ValuedStock) =>
    t(`goods.${stock.goodId}`, { defaultValue: stock.goodId });
  const columns: DataColumn<ValuedStock>[] = [
    { id: 'good', header: t('accounts.good'), cell: goodName, sortValue: goodName },
    {
      id: 'quantity',
      header: t('accounts.quantity'),
      cell: (stock) => number.format(stock.quantity),
      sortValue: (stock) => stock.quantity,
      numeric: true,
    },
    {
      id: 'unitPrice',
      header: t('accounts.unitPrice'),
      cell: (stock) =>
        stock.unitPrice === null || stock.pricedAt === null
          ? t('accounts.noPrice')
          : t('accounts.priceAt', {
              price: money(stock.unitPrice),
              date: date.format(stock.pricedAt),
            }),
      sortValue: (stock) => stock.unitPrice,
      numeric: true,
    },
    {
      id: 'value',
      header: t('accounts.value'),
      cell: (stock) => (stock.value === null ? t('accounts.notValued') : money(stock.value)),
      sortValue: (stock) => stock.value,
      numeric: true,
    },
  ];

  return (
    <Card className="flex flex-col gap-3" aria-labelledby="valued-stocks">
      <h2 id="valued-stocks" className="flex items-center gap-2 text-lg font-semibold">
        <Package aria-hidden="true" className="size-5 shrink-0 text-accent" />
        {t('accounts.stocks')}
      </h2>
      <Help>{t('accounts.stocksIntro')}</Help>
      {stocks.length === 0 ? (
        <EmptyState
          illustration="noStock"
          title={t('accounts.stocksEmpty')}
          action={
            <Link to="/agora" className="font-semibold text-primary underline underline-offset-4">
              {t('home.stockAction')}
            </Link>
          }
        />
      ) : (
        <DataTable
          caption={t('accounts.stocks')}
          columns={columns}
          rows={stocks}
          rowKey={(stock) => `${stock.cityId} ${stock.goodId}`}
          defaultSort={{ column: 'value', direction: 'descending' }}
          locale={i18n.language}
          sortAnnouncement={(column, direction) =>
            t(
              direction === 'ascending' ? 'accounts.sortedAscending' : 'accounts.sortedDescending',
              {
                column,
              },
            )
          }
        />
      )}
    </Card>
  );
}
