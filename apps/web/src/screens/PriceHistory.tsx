import {
  ArrowDownRight,
  ArrowUpRight,
  Badge,
  Card,
  EmptyState,
  Minus,
  ScrollText,
  TableScroll,
} from '@oikos/ui';
import { useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { LoadProblem, Loading } from './LoadProblem';
import { candleMarks, observedAverage, parsePriceSeries, priceSummary } from '../price-history';
import { dateTimeFormat } from '../game-time';

/** Lignes lues : de quoi couvrir plus d'une semaine de chandeliers d'une heure. */
const HISTORY_ROWS = 200;
/** Chandeliers tracés, et cadre du dessin (unités du graphique). */
const SHOWN = 48;
const [WIDTH, HEIGHT, MARGIN] = [320, 128, 6];
/** Ton de la variation : la flèche et le signe la disent aussi. */
const TONES = { flat: 'neutral', up: 'success', down: 'danger' } as const;

/** Lectures de l'historique d'un marché (5.3) : chandeliers de la série en cours et prix moyen observé. */
export function usePriceHistory(cityId: string, goodId: string, periodSeconds: number | null) {
  const market = { city_id: cityId, good_id: goodId };
  const candles = useRows<unknown>(
    'price_candles',
    'period_start, period_seconds, open, high, low, close, volume',
    'period_start',
    // Seulement la série en cours, une fois sa durée lue : après un changement, l'ancienne reste en base.
    periodSeconds === null ? null : { ...market, period_seconds: String(periodSeconds) },
    { limit: HISTORY_ROWS },
  );
  const series =
    candles.rows && periodSeconds !== null ? parsePriceSeries(candles.rows, periodSeconds) : null;
  const observed = useRows<unknown>(
    'observed_prices',
    'price, volume, window_seconds, observed_at',
    'good_id',
    market,
  );
  // `undefined` : pas de prix observé pour ce marché ; `null` : ligne illisible.
  const average = observed.rows?.[0] ? observedAverage(observed.rows[0], Date.now()) : undefined;
  return {
    cityId,
    goodId,
    series,
    average,
    // Variation jugée à l'heure du navigateur : indicative, comme « à récolter » sur la fiche d'un site.
    summary: series ? priceSummary(series, Date.now()) : null,
    loading: candles.rows === null && !candles.failed,
    failed: candles.failed || observed.failed || average === null || (!!candles.rows && !series),
    reload: () => Promise.all([candles.reload(), observed.reload()]),
  };
}
export type PriceHistoryReads = ReturnType<typeof usePriceHistory>;

function useFormats() {
  const { t, i18n } = useTranslation();
  const date = (instant?: number) => dateTimeFormat(i18n.language).format(instant);
  return { t, number: new Intl.NumberFormat(i18n.language), date };
}

/**
 * Cours d'un bien, en tête de sa fiche : dernier prix en grand, variation sur 24 heures (le sens dit par
 * la flèche et le signe, jamais par la couleur seule) et prix moyen observé, daté s'il est passé.
 */
export function PriceQuote({ history }: { history: PriceHistoryReads }) {
  const { t, number, date } = useFormats();
  const { i18n } = useTranslation();
  const { summary, average } = history;
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  });
  const trend =
    summary?.change === null || summary?.change === undefined || summary.change === 0
      ? 'flat'
      : summary.change > 0
        ? 'up'
        : 'down';
  const Arrow = { flat: Minus, up: ArrowUpRight, down: ArrowDownRight }[trend];
  return (
    <div className="flex flex-col gap-2">
      {summary && (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <p className="flex min-w-0 flex-col text-sm text-muted-foreground">
            <Trans
              i18nKey="agora.lastPrice"
              values={{ price: number.format(summary.last), date: date(summary.lastAt) }}
              components={{
                big: (
                  <span className="text-[2.5rem] leading-tight font-bold text-foreground tabular-nums" />
                ),
              }}
            />
          </p>
          <Badge tone={TONES[trend]} icon={<Arrow aria-hidden="true" />}>
            {summary.change === null
              ? t('agora.changeUnknown')
              : t('agora.change', { change: percent.format(summary.change) })}
          </Badge>
        </div>
      )}
      {average && (
        <p className="text-sm text-muted-foreground">
          {t(average.current ? 'agora.observedPrice' : 'agora.observedPriceDated', {
            hours: number.format(average.hours),
            price: number.format(average.price),
            volume: number.format(average.volume),
            date: date(average.observedAt),
          })}
        </p>
      )}
    </div>
  );
}

/**
 * Chandeliers d'un bien dans la cité (5.3) et tableau des mêmes valeurs. Le graphique est une image
 * décrite ; tout ce qu'il montre se lit aussi dans le tableau, au clavier comme au lecteur d'écran.
 * Hausse et baisse se distinguent par la forme (corps vide ou plein), pas par la couleur.
 */
export function PriceChart({ history }: { history: PriceHistoryReads }) {
  const { t, number, date } = useFormats();
  // Titre de la carte : le foyer y va après une relecture réussie.
  const title = useRef<HTMLHeadingElement>(null);
  const { series, summary } = history;
  const shown = series?.slice(-SHOWN) ?? [];
  const { marks, slot, low, high } = candleMarks(shown, WIDTH, HEIGHT - 2 * MARGIN);
  const good = t(`goods.${history.goodId}`);
  const scale = { low: number.format(low), high: number.format(high) };
  const bodyWidth = Math.min(slot * 0.6, 12);

  return (
    <Card className="flex flex-col gap-3">
      <h2 ref={title} tabIndex={-1} className="text-lg">
        {t('agora.priceTitle', { good })}
      </h2>
      {history.failed && <LoadProblem heading={title} onRetry={history.reload} />}
      {history.loading && <Loading />}
      {series?.length === 0 && (
        <EmptyState compact illustration="noOrder" title={t('agora.priceEmpty')} />
      )}
      {summary && (
        <>
          <svg
            role="img"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="block h-40 w-full rounded-lg bg-muted/40 p-1 text-foreground"
            // Le cadre s'étire sur la largeur de la carte ; les traits gardent leur épaisseur.
            preserveAspectRatio="none"
            aria-label={t('agora.chartLabel', {
              good,
              count: shown.length,
              from: date(shown[0]?.periodStart),
              to: date(shown.at(-1)?.periodStart),
              ...scale,
            })}
          >
            {/* Repères horizontaux : haut, milieu et bas de l'échelle, décoratifs. */}
            {[0.25, 0.5, 0.75].map((share) => (
              <line
                key={share}
                x1={0}
                x2={WIDTH}
                y1={HEIGHT * share}
                y2={HEIGHT * share}
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <g transform={`translate(0 ${MARGIN})`}>
              {marks.map((mark, index) => {
                const candle = shown[index];
                if (!candle) return null;
                return (
                  <g key={candle.periodStart}>
                    {/* Infobulle au survol, sur tout le créneau : plus large que le trait. */}
                    <title>
                      {t('agora.candle', {
                        date: date(candle.periodStart),
                        open: number.format(candle.open),
                        high: number.format(candle.high),
                        low: number.format(candle.low),
                        close: number.format(candle.close),
                        volume: number.format(candle.volume),
                      })}
                    </title>
                    <rect
                      x={mark.x - slot / 2}
                      y={-MARGIN}
                      width={slot}
                      height={HEIGHT}
                      fill="transparent"
                    />
                    <line
                      x1={mark.x}
                      x2={mark.x}
                      y1={mark.wickTop}
                      y2={mark.wickBottom}
                      stroke="currentColor"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x={mark.x - bodyWidth / 2}
                      y={mark.bodyTop}
                      width={bodyWidth}
                      height={mark.bodyHeight}
                      className={mark.trend === 'up' ? 'fill-surface' : 'fill-current'}
                      stroke="currentColor"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
            </g>
          </svg>
          <p className="text-sm text-muted-foreground">{t('agora.chartLegend', scale)}</p>
          <details className="mt-2">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md font-medium hover:text-primary">
              <ScrollText aria-hidden="true" className="size-4 shrink-0 text-accent" />
              {t('agora.priceTable')}
            </summary>
            <TableScroll label={t('agora.priceTitle', { good })}>
              <table className="w-full text-left tabular-nums">
                <caption className="sr-only">{t('agora.priceTitle', { good })}</caption>
                <thead>
                  <tr>
                    {(['period', 'open', 'high', 'low', 'close', 'volume'] as const).map(
                      (column) => (
                        <th
                          key={column}
                          scope="col"
                          className="py-1 pr-3 text-xs font-semibold text-muted-foreground"
                        >
                          {t(`agora.${column}`)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...shown].reverse().map((candle) => (
                    <tr key={candle.periodStart} className="border-t border-border-subtle">
                      <th scope="row" className="py-1.5 pr-3 font-normal whitespace-nowrap">
                        {date(candle.periodStart)}
                      </th>
                      {[candle.open, candle.high, candle.low, candle.close, candle.volume].map(
                        (value, column) => (
                          <td key={column} className="py-1.5 pr-3 whitespace-nowrap">
                            {number.format(value)}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </details>
        </>
      )}
    </Card>
  );
}
