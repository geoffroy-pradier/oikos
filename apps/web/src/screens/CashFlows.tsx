import { gameDayDate } from '@oikos/sim';
import { Card, Coins, EmptyState } from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { HOUSE_NATURES, parseCashFlowDays } from '../cash-flows';
import { useRows } from '../data';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { LoadProblem, Loading } from './LoadProblem';

/** Jours où la trésorerie a bougé, montrés les plus récents d'abord : un choix d'affichage, pas une règle du jeu. */
const SHOWN_DAYS = 7;

/**
 * Flux de trésorerie de la maison (4.1, vue `my_cash_flows`) : pour chacun des derniers jours de jeu où elle a
 * bougé, son net et le détail par nature, chacune libellée (les offrandes et consultations de la Pythie sous
 * `offerings`). Une nature que le client ne connaît pas encore est dite par son identifiant.
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
  const days =
    parsed && read.rows?.length === limit && parsed.length > 1 ? parsed.slice(0, -1) : parsed;
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const nature = (id: string, amount: number) =>
    (HOUSE_NATURES as readonly string[]).includes(id)
      ? t(`accounts.flows.natures.${id}`, { amount: money(amount) })
      : t('accounts.flows.unknown', { nature: id, amount: money(amount) });

  return (
    <Card className="flex flex-col gap-3">
      <h2 ref={title} tabIndex={-1} className="text-xl">
        {t('accounts.flows.title')}
      </h2>
      {read.rows === null && !read.failed && <Loading />}
      {(read.failed || (read.rows !== null && parsed === null)) && (
        <LoadProblem heading={title} onRetry={() => read.reload()} />
      )}
      {days?.length === 0 && (
        <EmptyState icon={<Coins />} title={t('accounts.flows.none')} headingLevel={3} />
      )}
      {days && days.length > 0 && (
        <ul className="flex flex-col gap-2">
          {days.slice(0, SHOWN_DAYS).map((day) => (
            <li
              key={day.day ?? 'none'}
              className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-raised p-3 shadow-sm"
            >
              <h3 className="font-medium">
                {t('accounts.flows.day', {
                  date:
                    day.day === null
                      ? t('accounts.flows.noDay')
                      : dates.format(gameDayDate(day.day)),
                  net: money(day.net),
                })}
              </h3>
              <ul className="flex flex-col text-muted-foreground">
                {day.flows.map((flow) => (
                  <li key={flow.nature}>{nature(flow.nature, flow.amount)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
