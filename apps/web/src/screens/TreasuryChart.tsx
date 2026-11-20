import { gameDayDate } from '@oikos/sim';
import { Card, cn, ScrollText, TableScroll, TrendingUp } from '@oikos/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTitle } from './SectionTitle';
import type { BalancePoint } from '../balance-history';
import { useMoney } from '../money';

const WIDTH = 720;
const HEIGHT = 160;
/** Marge haute et basse de la courbe dans son cadre, en unités du dessin. */
const PAD = 12;

/**
 * Trésorerie des derniers jours de jeu (4.1) : courbe des soldes de fin de jour, image décrite, doublée d'un tableau
 * des mêmes valeurs ouvert au clavier. Les dates sont celles des jours de jeu ; les repères (plus haut, plus bas,
 * dates) sont du texte, à leur taille sur téléphone comme sur ordinateur.
 */
export function TreasuryChart({
  points,
  className,
}: {
  points: readonly BalancePoint[];
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const id = useId();
  // Le tableau n'est rendu qu'ouvert : fermé, ses montants ne doublent pas ceux de l'écran.
  const [open, setOpen] = useState(false);
  const dates = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const date = (day: number) => dates.format(gameDayDate(day));
  const values = points.map((point) => point.balance);
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const x = (index: number) => (index / Math.max(points.length - 1, 1)) * WIDTH;
  const y = (value: number) =>
    high === low ? HEIGHT / 2 : PAD + ((high - value) / (high - low)) * (HEIGHT - 2 * PAD);
  const line = values.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(value)}`).join(' ');
  const [first, last] = [points[0], points.at(-1)];
  if (!first || !last) return null;
  const middle = points[Math.floor(points.length / 2)] ?? first;
  const signed = (amount: number) =>
    amount > 0 ? t('home.figures.plus', { amount: money(amount) }) : money(amount);

  return (
    <Card aria-labelledby={`${id}-title`} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <SectionTitle id={`${id}-title`} icon={<TrendingUp />}>
        {t('home.chart.title', { count: points.length })}
      </SectionTitle>
      {/* Plus haut et plus bas au-dessus du dessin : jamais sur la courbe (#869). */}
      <p
        aria-hidden="true"
        className="-mb-1 flex flex-wrap justify-between gap-x-4 text-xs text-muted-foreground tabular-nums"
      >
        <span>{t('home.chart.high', { amount: money(high) })}</span>
        {high !== low && <span>{t('home.chart.low', { amount: money(low) })}</span>}
      </p>
      <div className="relative">
        <svg
          role="img"
          aria-label={t('home.chart.label', {
            count: points.length,
            from: money(first.balance),
            to: money(last.balance),
            high: money(high),
            low: money(low),
          })}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="block h-40 w-full text-primary"
        >
          <defs>
            <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Repères horizontaux : plus haut, milieu, plus bas ; décoratifs. */}
          {[PAD, HEIGHT / 2, HEIGHT - PAD].map((level) => (
            <line
              key={level}
              x1={0}
              x2={WIDTH}
              y1={level}
              y2={level}
              className="stroke-border-subtle"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={`${line} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`} fill={`url(#${id}-area)`} />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* Le dernier solde, en point : du HTML, pour rester rond quand le dessin s'étire. */}
        <span
          aria-hidden="true"
          className="absolute size-3 -translate-1/2 rounded-full border-2 border-surface bg-primary"
          style={{ left: '100%', top: `${(y(last.balance) / HEIGHT) * 100}%` }}
        />
      </div>
      <div aria-hidden="true" className="flex justify-between text-xs text-muted-foreground">
        <span>{date(first.day)}</span>
        <span>{date(middle.day)}</span>
        <span>{date(last.day)}</span>
      </div>
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-sm font-medium hover:text-primary">
          <ScrollText aria-hidden="true" className="size-4 shrink-0 text-accent" />
          {t('home.chart.table')}
        </summary>
        {open && (
          <TableScroll label={t('home.chart.title', { count: points.length })}>
            <table className="w-full text-left text-sm tabular-nums">
              <caption className="sr-only">
                {t('home.chart.title', { count: points.length })}
              </caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t('home.chart.day')}
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    {t('home.chart.balance')}
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    {t('home.chart.net')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((point) => (
                  <tr key={point.day} className="border-t border-border-subtle">
                    <th scope="row" className="py-1.5 pr-3 font-normal whitespace-nowrap">
                      {date(point.day)}
                    </th>
                    <td className="py-1.5 pr-3 text-right">{money(point.balance)}</td>
                    <td className="py-1.5 text-right">
                      {point.net === 0 ? '—' : signed(point.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </details>
    </Card>
  );
}
