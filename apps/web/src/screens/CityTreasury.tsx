import { gameDayDate } from '@oikos/sim';
import { Card } from '@oikos/ui';
import { useRef } from 'react';
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

  return (
    <Card className="flex flex-col gap-3">
      <h2 ref={title} tabIndex={-1} className="text-xl">
        {t('treasury.title')}
      </h2>
      {loading && <Loading />}
      {failed && <LoadProblem heading={title} onRetry={reload} />}
      {balance !== null && days && rate && (
        <>
          <p className="text-lg font-semibold">
            {t('treasury.balance', { amount: money(balance) })}
          </p>
          <ul className="flex flex-col gap-1">
            <li>
              {t('treasury.marketTax', { rate: percent.format(rate.marketTaxRateBps / BPS) })}
            </li>
            <li>
              {t('treasury.portDues', { factor: factor.format(rate.portDuesCoefficientBps / BPS) })}
            </li>
          </ul>
          <h3 className="font-semibold">{t('treasury.flows')}</h3>
          {days.length === 0 && <p className="text-muted-foreground">{t('treasury.noFlows')}</p>}
          <ul className="flex flex-col gap-2">
            {days.slice(0, SHOWN_DAYS).map((day) => (
              <li
                key={day.day ?? 'none'}
                className="flex flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0"
              >
                <h4 className="font-medium">
                  {day.day === null
                    ? t('treasury.noDay')
                    : t('treasury.day', {
                        date: dates.format(gameDayDate(day.day)),
                        net: money(day.net),
                      })}
                </h4>
                <ul className="flex flex-col text-muted-foreground">
                  {day.flows.map((flow) => (
                    <li key={flow.nature}>
                      {t(`treasury.natures.${flow.nature}`, { amount: money(flow.amount) })}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
