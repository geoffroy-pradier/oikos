import { Card, cn, Coins, Package, StatCard, TrendingUp, Wheat } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { variation, type BalancePoint } from '../balance-history';
import type { useHomeFigures } from '../home-figures';
import { useMoney } from '../money';
import type { SitesSummary } from './Sites';

/** Jours de jeu de la variation de la trésorerie : un choix d'affichage. */
const WEEK = 7;

/**
 * Chiffres clés du tableau de bord : trésorerie (variation sur 7 jours, séquestre, ordres à l'agora), résultat du
 * jour, stocks valorisés et sites en activité. Sur téléphone, la trésorerie passe en tête, en carte inversée avec
 * sa courbe, et les trois autres en petites cartes.
 */
export function HomeFigures(props: {
  figures: ReturnType<typeof useHomeFigures>;
  balance: number | undefined;
  held: number;
  /** Ordres ouverts à l'agora ; `null` tant qu'ils ne sont pas lus. */
  orders: { buys: number; sells: number } | null;
  sites: SitesSummary | null;
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const number = new Intl.NumberFormat(i18n.language);
  const { history, today, sheet } = props.figures;
  const week = history && variation(history, WEEK);
  const signed = (amount: number) =>
    amount > 0 ? t('home.figures.plus', { amount: money(amount) }) : money(amount);
  const charges = today && -(today.purchases + today.taxes + today.upkeep);
  return (
    <section
      aria-label={t('home.figures.title')}
      className="grid grid-cols-3 gap-2 lg:grid-cols-4 lg:gap-4"
    >
      <Card
        className={cn(
          'col-span-3 flex flex-col gap-1.5 rounded-2xl border-inverse bg-inverse p-4 text-inverse-foreground',
          'lg:col-span-1 lg:rounded-xl lg:border-border-subtle lg:bg-surface lg:text-foreground',
        )}
      >
        <div className="flex items-center justify-between gap-2 text-[0.8125rem] text-inverse-muted lg:text-muted-foreground">
          <span>{t('home.treasury')}</span>
          <Coins aria-hidden="true" className="size-4" />
        </div>
        <p className="text-[2rem] leading-tight font-bold tabular-nums lg:text-2xl">
          {props.balance === undefined ? '—' : money(props.balance)}
        </p>
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[0.8125rem] text-inverse-muted lg:text-muted-foreground">
            {week !== null && (
              <p>
                <span
                  className={cn(
                    'font-semibold text-inverse-foreground tabular-nums',
                    week > 0
                      ? 'lg:text-success'
                      : week < 0
                        ? 'lg:text-danger'
                        : 'lg:text-foreground',
                  )}
                >
                  <span aria-hidden="true">{week > 0 ? '▲ ' : week < 0 ? '▼ ' : '– '}</span>
                  {signed(week)}
                </span>{' '}
                {t('home.figures.week')}
              </p>
            )}
            {props.held > 0 && <p>{t('home.held', { amount: money(props.held) })}</p>}
            {props.orders && (
              <p>
                {props.orders.buys + props.orders.sells === 0
                  ? t('home.openOrdersNone')
                  : t('home.openOrders', {
                      buys: t('home.openBuys', {
                        count: props.orders.buys,
                        number: number.format(props.orders.buys),
                      }),
                      sells: t('home.openSells', {
                        count: props.orders.sells,
                        number: number.format(props.orders.sells),
                      }),
                    })}{' '}
                <Link to="/agora" className="font-medium underline underline-offset-4">
                  {t('home.toAgora')}
                </Link>
              </p>
            )}
          </div>
          {history && <Sparkline points={history} />}
        </div>
      </Card>
      <StatCard
        dense
        label={t('home.figures.today')}
        icon={<TrendingUp />}
        value={today === undefined ? '—' : signed(today?.operating_result ?? 0)}
        hint={
          today &&
          t('home.figures.todayHint', {
            sales: money(today.sales),
            charges: money(charges ?? 0),
          })
        }
      />
      <StatCard
        dense
        label={t('home.figures.stocks')}
        icon={<Package />}
        value={sheet ? money(sheet.stockValue) : '—'}
        hint={
          sheet && sheet.unpricedStocks > 0
            ? t('accounts.unpriced', { count: sheet.unpricedStocks })
            : undefined
        }
      />
      <StatCard
        dense
        label={t('home.figures.sites')}
        icon={<Wheat />}
        value={
          props.sites
            ? t('home.figures.sitesValue', {
                running: number.format(props.sites.running),
                total: number.format(props.sites.total),
              })
            : '—'
        }
        hint={
          props.sites &&
          t('home.figures.sitesHint', {
            workers: t('home.figures.workers', {
              count: props.sites.workers,
              number: number.format(props.sites.workers),
            }),
            stewards: t('home.figures.stewards', {
              count: props.sites.posted,
              number: number.format(props.sites.posted),
            }),
          })
        }
      />
    </section>
  );
}

/** Courbe de la trésorerie en miniature, sur téléphone ; décorative, la carte de la courbe porte ses valeurs. */
function Sparkline({ points }: { points: readonly BalancePoint[] }) {
  const values = points.map((point) => point.balance);
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const y = (value: number) => (high === low ? 18 : 32 - ((value - low) / (high - low)) * 28);
  const step = 120 / Math.max(points.length - 1, 1);
  const path = values.map((value, i) => `${i === 0 ? 'M' : 'L'}${i * step} ${y(value)}`).join(' ');
  return (
    <svg
      aria-hidden="true"
      viewBox="-2 0 124 36"
      className="h-9 w-24 shrink-0 text-accent-decorative lg:hidden"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
