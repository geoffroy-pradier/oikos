import { gameDayDate } from '@oikos/sim';
import { Card, Coins, DataTable, EmptyState, type DataColumn } from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { HOUSE_NATURES, parseCashFlowDays, type CashFlowDay } from '../cash-flows';
import { useRows } from '../data';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { LoadProblem, Loading } from './LoadProblem';

/** Jours où la trésorerie a bougé, montrés les plus récents d'abord : un choix d'affichage, pas une règle du jeu. */
const SHOWN_DAYS = 7;
const inflow = (day: CashFlowDay) =>
  day.flows.reduce((sum, flow) => sum + Math.max(0, flow.amount), 0);
const outflow = (day: CashFlowDay) =>
  day.flows.reduce((sum, flow) => sum + Math.min(0, flow.amount), 0);

/**
 * Flux de trésorerie de la maison (4.1, vue `my_cash_flows`) : pour chacun des derniers jours de jeu où elle a
 * bougé, ses entrées, ses sorties, son net et le détail par nature, chacune libellée (les offrandes et
 * consultations de la Pythie sous `offerings`). Une nature que le client ne connaît pas encore est dite par
 * son identifiant. Le graphique en barres (entrées au-dessus de l'axe, sorties en dessous) est une image
 * décrite, doublée du tableau des mêmes valeurs (spécification 10, Exigences).
 */
export function CashFlows() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const title = useRef<HTMLHeadingElement>(null);
  const limit = SHOWN_DAYS * HOUSE_NATURES.length;
  const read = useRows<unknown>(
    'my_cash_flows',
    'house_id, account, game_day, nature, amount',
    'game_day',
    { house_id: house.id, account: 'treasury' },
    { limit },
  );
  const parsed = read.rows === null ? null : parseCashFlowDays(read.rows, house.id);
  // Lecture pleine : le plus ancien jour lu peut être coupé, il n'est pas montré.
  const days = (
    parsed && read.rows?.length === limit && parsed.length > 1 ? parsed.slice(0, -1) : parsed
  )?.slice(0, SHOWN_DAYS);
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const short = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const dayOnly = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', timeZone: 'UTC' });
  const dayName = (day: CashFlowDay, format = dates) =>
    day.day === null ? t('accounts.flows.noDay') : format.format(gameDayDate(day.day));
  const nature = (id: string, amount: number) =>
    (HOUSE_NATURES as readonly string[]).includes(id)
      ? t(`accounts.flows.natures.${id}`, { amount: money(amount) })
      : t('accounts.flows.unknown', { nature: id, amount: money(amount) });
  const columns: DataColumn<CashFlowDay>[] = [
    {
      id: 'day',
      header: t('accounts.flows.columns.day'),
      cell: (day) => dayName(day),
      sortValue: (day) => day.day,
    },
    ...(
      [
        ['in', inflow],
        ['out', outflow],
        ['net', (day: CashFlowDay) => day.net],
      ] as const
    ).map(([id, amount]) => ({
      id,
      header: t(`accounts.flows.columns.${id}`),
      cell: (day: CashFlowDay) => (
        <span className={id === 'net' ? 'font-semibold whitespace-nowrap' : 'whitespace-nowrap'}>
          {money(amount(day))}
        </span>
      ),
      sortValue: amount,
      numeric: true,
    })),
    {
      id: 'detail',
      header: t('accounts.flows.columns.detail'),
      cell: (day) => (
        <ul className="flex flex-col text-muted-foreground">
          {day.flows.map((flow) => (
            <li key={flow.nature}>{nature(flow.nature, flow.amount)}</li>
          ))}
        </ul>
      ),
    },
  ];
  // Échelle commune : la plus forte entrée et la plus forte sortie se partagent la hauteur du graphique.
  const top = Math.max(0, ...(days ?? []).map(inflow));
  const bottom = Math.max(0, ...(days ?? []).map((day) => -outflow(day)));
  const span = top + bottom;
  const chronological = [...(days ?? [])].reverse();

  return (
    <Card className="flex flex-col gap-3" aria-labelledby="cash-flows">
      <h2
        id="cash-flows"
        ref={title}
        tabIndex={-1}
        className="flex items-center gap-2 text-lg font-semibold"
      >
        <Coins aria-hidden="true" className="size-5 shrink-0 text-accent" />
        {t('accounts.flows.title')}
      </h2>
      {read.rows === null && !read.failed && <Loading />}
      {(read.failed || (read.rows !== null && parsed === null)) && (
        <LoadProblem heading={title} onRetry={() => read.reload()} />
      )}
      {days?.length === 0 && <EmptyState illustration="noEntry" title={t('accounts.flows.none')} />}
      {days && days.length > 0 && span > 0 && (
        <div className="flex flex-col gap-2">
          <ul
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
            aria-hidden="true"
          >
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-primary" />
              {t('accounts.flows.columns.in')}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-muted-foreground" />
              {t('accounts.flows.columns.out')}
            </li>
          </ul>
          <div
            role="img"
            aria-label={t('accounts.flows.chart', { count: days.length })}
            className="flex h-44 items-stretch gap-1 sm:gap-3"
          >
            {chronological.map((day) => (
              <div
                key={day.day ?? 'none'}
                title={t('accounts.flows.bar', {
                  date: dayName(day),
                  in: money(inflow(day)),
                  out: money(outflow(day)),
                  net: money(day.net),
                })}
                className="group flex min-w-0 flex-1 flex-col items-center"
              >
                <div
                  className="flex w-full justify-center"
                  style={{ height: `${(top / span) * 85}%` }}
                >
                  <span
                    className="mt-auto w-full max-w-10 rounded-t-[4px] bg-primary transition-opacity duration-(--motion-fast) group-hover:opacity-80"
                    style={{ height: `${(inflow(day) / (top || 1)) * 100}%` }}
                  />
                </div>
                <span className="h-px w-full shrink-0 bg-border" />
                <div
                  className="flex w-full justify-center"
                  style={{ height: `${(bottom / span) * 85}%` }}
                >
                  <span
                    className="w-full max-w-10 rounded-b-[4px] bg-muted-foreground transition-opacity duration-(--motion-fast) group-hover:opacity-80"
                    style={{ height: `${(-outflow(day) / (bottom || 1)) * 100}%` }}
                  />
                </div>
                <span className="mt-auto truncate pt-1 text-[0.6875rem] text-muted-foreground tabular-nums">
                  <span className="max-sm:hidden">{dayName(day, short)}</span>
                  {/* Sur téléphone, le quantième seul : la date entière est dans le tableau. */}
                  <span className="sm:hidden">{dayName(day, dayOnly)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {days && days.length > 0 && (
        <DataTable
          caption={t('accounts.flows.title')}
          columns={columns}
          rows={days}
          rowKey={(day) => String(day.day ?? 'none')}
          defaultSort={{ column: 'day', direction: 'descending' }}
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
