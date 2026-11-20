import { DataTable, EmptyState, type SortDirection } from '@oikos/ui';
import { useTranslation } from 'react-i18next';

/** Créé (robinets) et détruit (puits) un jour de jeu, en oboles nettes. */
export interface DayFlow {
  gameDay: number;
  faucets: number;
  sinks: number;
}

const [WIDTH, HEIGHT] = [720, 180];

/**
 * Robinets et puits par jour (15.1) : barres appariées, du plus ancien au plus récent, doublées du tableau des
 * mêmes valeurs (le dessin est décoratif pour un lecteur d'écran, qui en lit le résumé puis le tableau). Un net
 * négatif descend sous la ligne du zéro.
 */
export function DailyFlows({
  days,
  date,
  caption,
}: {
  days: readonly DayFlow[];
  date: (gameDay: number) => string;
  caption: string;
}) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const ordered = [...days].sort((a, b) => a.gameDay - b.gameDay);
  const values = ordered.flatMap((day) => [day.faucets, day.sinks]);
  const [top, bottom] = [Math.max(0, ...values), Math.min(0, ...values)];
  const y = (value: number) => ((top - value) / (top - bottom || 1)) * HEIGHT;
  const slot = WIDTH / Math.max(ordered.length, 1);
  const bar = Math.min(28, slot * 0.36);
  const range = (pick: (day: DayFlow) => number) => {
    const all = ordered.map(pick);
    return { min: number.format(Math.min(...all)), max: number.format(Math.max(...all)) };
  };
  const sorted = (header: string, direction: SortDirection) =>
    t('app.sorted', { column: header, direction: t(`app.${direction}`) });

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-4 shadow-sm lg:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{caption}</h3>
        <ul aria-hidden="true" className="flex gap-4 text-xs text-foreground-secondary">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-accent-decorative" />
            {t('economy.chart.faucets')}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-foreground-secondary" />
            {t('economy.chart.sinks')}
          </li>
        </ul>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t('economy.chart.summary', {
          count: ordered.length,
          faucets: range((day) => day.faucets),
          sinks: range((day) => day.sinks),
        })}
        className="block h-auto w-full"
      >
        <line x1={0} x2={WIDTH} y1={y(0)} y2={y(0)} className="stroke-border-subtle" />
        {ordered.map((day, index) => {
          const x = index * slot + slot / 2;
          const rect = (value: number, left: number, fill: string) => (
            <rect
              x={left}
              y={y(Math.max(value, 0))}
              width={bar}
              height={Math.max(Math.abs(y(value) - y(0)), value === 0 ? 0 : 2)}
              rx={Math.min(4, bar / 4)}
              className={fill}
            />
          );
          return (
            <g key={day.gameDay}>
              {rect(day.faucets, x - bar - 1, 'fill-accent-decorative')}
              {rect(day.sinks, x + 1, 'fill-foreground-secondary')}
            </g>
          );
        })}
      </svg>
      {/* Repères de date hors du dessin : lisibles à 360 px, où le dessin rapetisse. */}
      <p
        aria-hidden="true"
        className="-mt-2 flex justify-between gap-2 text-xs text-muted-foreground"
      >
        {[...new Set([ordered[0], ordered.at(-1)])].map(
          (day) => day && <span key={day.gameDay}>{date(day.gameDay)}</span>,
        )}
      </p>
      <DataTable
        caption={caption}
        rows={ordered}
        rowKey={(day) => String(day.gameDay)}
        locale={i18n.language}
        defaultSort={{ column: 'day', direction: 'descending' }}
        sortAnnouncement={sorted}
        columns={[
          {
            id: 'day',
            header: t('economy.chart.day'),
            cell: (day) => date(day.gameDay),
            sortValue: (day) => day.gameDay,
          },
          ...(['faucets', 'sinks'] as const).map((part) => ({
            id: part,
            header: t(`economy.chart.${part}`),
            numeric: true,
            cell: (day: DayFlow) => number.format(day[part]),
            sortValue: (day: DayFlow) => day[part],
          })),
          {
            id: 'net',
            header: t('economy.chart.net'),
            numeric: true,
            cell: (day) => number.format(day.faucets - day.sinks),
            sortValue: (day) => day.faucets - day.sinks,
          },
        ]}
      />
    </div>
  );
}

/**
 * Part de chaque puits dans ce qu'ont détruit les puits depuis l'origine : la part est écrite, la barre ne fait
 * que la montrer. Un puits à net nul ou négatif n'a pas de part.
 */
export function SinkShares({ sinks }: { sinks: readonly { name: string; total: number }[] }) {
  const { t, i18n } = useTranslation();
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 1,
  });
  const positive = sinks.filter((sink) => sink.total > 0).sort((a, b) => b.total - a.total);
  const sum = positive.reduce((total, sink) => total + sink.total, 0);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4 shadow-sm lg:p-5">
      <h3 className="text-base font-semibold">{t('economy.shares')}</h3>
      {positive.length === 0 ? (
        <EmptyState compact illustration="noEntry" title={t('economy.noShares')} />
      ) : (
        <dl className="flex flex-col gap-2.5 text-sm tabular-nums">
          {positive.map((sink) => {
            const share = sink.total / sum;
            return (
              <div key={sink.name} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                <dt className="min-w-0 wrap-anywhere">{sink.name}</dt>
                <dd className="font-semibold">{percent.format(share)}</dd>
                <dd aria-hidden="true" className="col-span-2 h-1.5 rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-foreground-secondary"
                    style={{ width: `${share * 100}%` }}
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
