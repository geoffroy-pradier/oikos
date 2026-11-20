import { gameDayDate } from '@oikos/sim';
import { Anchor, Card, ChevronRight, Coins, Landmark, StatCard, Store } from '@oikos/ui';
import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useHouse } from '../house';
import { useMoney } from '../money';
import {
  parseCityRate,
  parseTreasuryBalance,
  parseTreasuryDays,
  TREASURY_NATURES,
} from '../treasury';
import { LoadProblem, Loading } from './LoadProblem';

/** Jours où le trésor a bougé, montrés les plus récents d'abord : un choix d'affichage, pas une règle du jeu. */
const SHOWN_DAYS = 7;
const BPS = 10_000;

/**
 * Trésor public de la cité de la maison (6.2, 5.6) : son solde, ses flux par jour de jeu et par nature
 * (taxe de marché, droit de port, grands travaux, fêtes, autres) et les taux en vigueur. Lecture seule ;
 * les comptes publics ne disent rien des maisons.
 */
export function CityTreasury() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const title = useRef<HTMLHeadingElement>(null);
  const city = { city_id: house.cityId };
  const balanceRows = useRows<unknown>('city_treasury', 'city_id, balance', 'city_id', city);
  const flowRows = useRows<unknown>(
    'city_treasury_flows',
    'city_id, game_day, nature, amount',
    'game_day',
    city,
    // Les plus récentes d'abord, au plus une ligne par nature et par jour : les jours montrés sont entiers.
    { limit: SHOWN_DAYS * TREASURY_NATURES.length },
  );
  const rateRows = useRows<unknown>(
    'city_rates',
    'city_id, market_tax_rate_bps, port_dues_coefficient_bps',
    'city_id',
    city,
  );
  const reads = [balanceRows, flowRows, rateRows];
  const balance =
    balanceRows.rows === null ? null : parseTreasuryBalance(balanceRows.rows, house.cityId);
  const days = flowRows.rows === null ? null : parseTreasuryDays(flowRows.rows, house.cityId);
  const rate = rateRows.rows === null ? null : parseCityRate(rateRows.rows, house.cityId);
  const loading = reads.some((read) => read.rows === null && !read.failed);
  const failed =
    reads.some((read) => read.failed) || (!loading && [balance, days, rate].includes(null));
  const reload = () => Promise.all(reads.map((read) => read.reload()));
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 2,
  });
  const factor = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const short = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

  const shown = days?.slice(0, SHOWN_DAYS) ?? [];
  // Recettes et dépenses de chaque jour, du plus ancien au plus récent, pour les barres et leur tableau.
  const bars = [...shown].reverse().map((day) => ({
    day,
    income: day.flows.reduce((sum, flow) => sum + Math.max(flow.amount, 0), 0),
    spending: day.flows.reduce((sum, flow) => sum - Math.min(flow.amount, 0), 0),
  }));
  const highest = Math.max(1, ...bars.flatMap((bar) => [bar.income, bar.spending]));
  const height = (amount: number) => `${Math.round((amount / highest) * 100)}%`;
  const dayName = (day: number | null) =>
    day === null ? t('treasury.noDay') : dates.format(gameDayDate(day));
  const total = (key: 'income' | 'spending') => bars.reduce((sum, bar) => sum + bar[key], 0);
  // Chiffre clé en carte ; la phrase entière est ce que lit un lecteur d'écran.
  const figure = (label: string, value: string, sentence: string, icon: ReactNode) => (
    <div key={label}>
      <div aria-hidden="true" className="h-full">
        <StatCard label={label} value={value} icon={icon} className="h-full" />
      </div>
      <p className="sr-only">{sentence}</p>
    </div>
  );

  return (
    <section className="flex flex-col gap-4">
      <h2
        ref={title}
        tabIndex={-1}
        className="flex items-center gap-2 text-lg font-semibold [&_svg]:size-5 [&_svg]:text-accent"
      >
        <Coins aria-hidden="true" />
        {t('treasury.title')}
      </h2>
      {loading && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {balance !== null && days && rate && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>:first-child]:col-span-2 sm:[&>:first-child]:col-span-1">
            {figure(
              t('treasury.figures.balance'),
              money(balance),
              t('treasury.balance', { amount: money(balance) }),
              <Landmark />,
            )}
            {figure(
              t('treasury.figures.marketTax'),
              percent.format(rate.marketTaxRateBps / BPS),
              t('treasury.marketTax', { rate: percent.format(rate.marketTaxRateBps / BPS) }),
              <Store />,
            )}
            {figure(
              t('treasury.figures.portDues'),
              t('treasury.figures.factor', {
                factor: factor.format(rate.portDuesCoefficientBps / BPS),
              }),
              t('treasury.portDues', { factor: factor.format(rate.portDuesCoefficientBps / BPS) }),
              <Anchor />,
            )}
          </div>
          <Card className="flex flex-col gap-3">
            <h3 className="font-semibold">{t('treasury.flows')}</h3>
            {days.length === 0 && <p className="text-muted-foreground">{t('treasury.noFlows')}</p>}
            {bars.length > 0 && (
              <>
                {/* Recettes au-dessus de la ligne, dépenses dessous : la place dit le sens, pas la couleur. */}
                <div
                  role="img"
                  aria-label={t('treasury.chart', {
                    count: bars.length,
                    income: money(total('income')),
                    spending: money(total('spending')),
                  })}
                  className="grid h-44 auto-cols-fr grid-flow-col gap-1.5 sm:gap-3"
                >
                  {bars.map((bar) => (
                    <div key={bar.day.day ?? 'none'} className="grid grid-rows-[1fr_1fr_auto]">
                      <div className="flex items-end justify-center border-b border-border">
                        <span
                          className="w-full max-w-10 rounded-t-md bg-primary"
                          style={{ height: height(bar.income) }}
                        />
                      </div>
                      <div className="flex items-start justify-center">
                        <span
                          className="w-full max-w-10 rounded-b-md bg-muted-foreground/60"
                          style={{ height: height(bar.spending) }}
                        />
                      </div>
                      <span className="pt-1 text-center text-xs leading-tight text-muted-foreground">
                        {bar.day.day === null ? '—' : short.format(gameDayDate(bar.day.day))}
                      </span>
                    </div>
                  ))}
                </div>
                <ul
                  aria-hidden="true"
                  className="flex flex-wrap gap-x-4 text-xs text-muted-foreground"
                >
                  <li className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-primary" />
                    {t('treasury.income')}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-muted-foreground/60" />
                    {t('treasury.spending')}
                  </li>
                </ul>
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium hover:text-primary">
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--motion-fast) group-open:rotate-90"
                    />
                    {t('treasury.table')}
                  </summary>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm tabular-nums">
                      <caption className="sr-only">{t('treasury.flows')}</caption>
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          {(['day', 'income', 'spending', 'net'] as const).map((column) => (
                            <th
                              key={column}
                              scope="col"
                              className={`py-1 pr-3 font-medium ${column === 'day' ? '' : 'text-right'}`}
                            >
                              {t(`treasury.${column === 'day' ? 'dayColumn' : column}`)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...bars].reverse().map((bar) => (
                          <tr key={bar.day.day ?? 'none'} className="border-t border-border-subtle">
                            <th scope="row" className="py-1.5 pr-3 font-normal whitespace-nowrap">
                              {dayName(bar.day.day)}
                            </th>
                            <td className="py-1.5 pr-3 text-right">{money(bar.income)}</td>
                            <td className="py-1.5 pr-3 text-right">{money(bar.spending)}</td>
                            <td className="py-1.5 pr-3 text-right font-medium">
                              {money(bar.day.net)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </Card>
          {/* Le détail de chaque jour, par nature. */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((day) => (
              <li key={day.day ?? 'none'}>
                <Card className="flex h-full flex-col gap-2">
                  <h4 className="font-semibold">
                    {day.day === null
                      ? t('treasury.noDay')
                      : t('treasury.day', {
                          date: dates.format(gameDayDate(day.day)),
                          net: money(day.net),
                        })}
                  </h4>
                  <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                    {day.flows.map((flow) => (
                      <li key={flow.nature}>
                        {t(`treasury.natures.${flow.nature}`, { amount: money(flow.amount) })}
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
