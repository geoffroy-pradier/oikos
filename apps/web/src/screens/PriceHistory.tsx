import { ArrowDownRight, ArrowUpRight, Badge, Card, Minus, ScrollText } from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { LoadProblem, Loading } from './LoadProblem';
import { candleMarks, observedAverage, parsePriceSeries, priceSummary } from '../price-history';

/** Lignes lues : de quoi couvrir plus d'une semaine de chandeliers d'une heure. */
const HISTORY_ROWS = 200;
/** Chandeliers tracés, et cadre du dessin (unités du graphique). */
const SHOWN = 48;
const [WIDTH, HEIGHT, MARGIN] = [320, 128, 6];

/**
 * Historique des prix d'un bien dans la cité (5.3) : dernier prix, variation sur 24 heures, prix moyen
 * observé (daté s'il est plus ancien que sa fenêtre), chandeliers et tableau des mêmes valeurs. Le
 * graphique est une image décrite ; tout ce qu'il montre se lit aussi dans le tableau, au clavier comme
 * au lecteur d'écran. Hausse et baisse se distinguent par la forme (corps vide ou plein), pas par la
 * couleur.
 */
export function PriceHistory(props: { cityId: string; goodId: string; periodSeconds: number }) {
  const { cityId, goodId, periodSeconds } = props;
  const { t, i18n } = useTranslation();
  // Titre de la carte : le foyer y va après une relecture réussie.
  const title = useRef<HTMLHeadingElement>(null);
  const market = { city_id: cityId, good_id: goodId };
  const candles = useRows<unknown>(
    'price_candles',
    'period_start, period_seconds, open, high, low, close, volume',
    'period_start',
    // Seulement la série en cours : après un changement de durée, l'ancienne reste en base.
    { ...market, period_seconds: String(periodSeconds) },
    { limit: HISTORY_ROWS },
  );
  const series = candles.rows ? parsePriceSeries(candles.rows, periodSeconds) : null;
  const observed = useRows<unknown>(
    'observed_prices',
    'price, volume, window_seconds, observed_at',
    'good_id',
    market,
  );
  // `undefined` : pas de prix observé pour ce marché ; `null` : ligne illisible.
  const average = observed.rows?.[0] ? observedAverage(observed.rows[0], Date.now()) : undefined;
  // Variation jugée à l'heure du navigateur : indicative, comme « à récolter » sur la fiche d'un site.
  const summary = series ? priceSummary(series, Date.now()) : null;
  const shown = series?.slice(-SHOWN) ?? [];
  const { marks, slot, low, high } = candleMarks(shown, WIDTH, HEIGHT - 2 * MARGIN);

  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  });
  const date = (instant?: number) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
      instant,
    );
  const good = t(`goods.${goodId}`);
  const scale = { low: number.format(low), high: number.format(high) };
  const bodyWidth = Math.min(slot * 0.6, 12);

  return (
    <Card className="flex flex-col gap-3">
      <h2 ref={title} tabIndex={-1} className="text-xl">
        {t('agora.priceTitle', { good })}
      </h2>
      {(candles.failed || observed.failed || average === null || (candles.rows && !series)) && (
        <LoadProblem
          heading={title}
          onRetry={() => Promise.all([candles.reload(), observed.reload()])}
        />
      )}
      {candles.rows === null && !candles.failed && <Loading />}
      {series?.length === 0 && (
        <p className="rounded-lg border border-dashed border-border-subtle p-4 text-muted-foreground">
          {t('agora.priceEmpty')}
        </p>
      )}
      {summary && (
        <>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <strong className="text-lg">
              {t('agora.lastPrice', {
                price: number.format(summary.last),
                date: date(summary.lastAt),
              })}
            </strong>
            <Badge
              tone="aegean"
              icon={
                summary.change === null || summary.change === 0 ? (
                  <Minus aria-hidden="true" />
                ) : summary.change > 0 ? (
                  <ArrowUpRight aria-hidden="true" />
                ) : (
                  <ArrowDownRight aria-hidden="true" />
                )
              }
            >
              {summary.change === null
                ? t('agora.changeUnknown')
                : t('agora.change', { change: percent.format(summary.change) })}
            </Badge>
          </p>
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
            <div className="overflow-x-auto">
              <table className="w-full text-left tabular-nums">
                <caption className="sr-only">{t('agora.priceTitle', { good })}</caption>
                <thead>
                  <tr>
                    {(['period', 'open', 'high', 'low', 'close', 'volume'] as const).map(
                      (column) => (
                        <th key={column} scope="col" className="eyebrow py-1 pr-3 font-semibold">
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
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
