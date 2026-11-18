import { Card, EmptyState, Users } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useHouse } from '../house';
import { parseCityLabor, staffByCity } from '../labor';
import { useMoney } from '../money';
import { LoadProblem, Loading } from './LoadProblem';

/**
 * Personnel de la maison (4.4, 4.5) : les travailleurs de ses sites, cité par cité, logés par ses biens
 * ou non, et ce que coûte chaque jour l'hébergement des autres chez les PNJ, au prix du jour de la cité
 * (vues `my_workforce` et `labor_market`). Lecture seule.
 */
export function StaffScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const title = useRef<HTMLHeadingElement>(null);
  const staffRows = useRows<unknown>(
    'my_workforce',
    'site_id, city_id, workers, housed, unhoused',
    'site_id',
  );
  const laborRows = useRows<unknown>(
    'labor_market',
    'city_id, game_day, supply, employed, unhoused, wage_oboles, lodging_oboles',
    'city_id',
  );
  const labor = laborRows.rows === null ? null : parseCityLabor(laborRows.rows);
  const nameOf = (cityId: string) => house.cityNames[cityId] ?? cityId;
  const cities = staffRows.rows === null ? null : staffByCity(staffRows.rows, labor, nameOf);
  const number = new Intl.NumberFormat(i18n.language);
  const failed =
    staffRows.failed || laborRows.failed || (staffRows.rows !== null && cities === null);
  const loading = !failed && (staffRows.rows === null || laborRows.rows === null);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <h1 ref={title} tabIndex={-1} className="text-2xl">
          {t('staff.title')}
        </h1>
        <p className="text-muted-foreground">{t('staff.intro')}</p>
        <Link to="/" className="inline-flex min-h-11 items-center underline underline-offset-4">
          {t('staff.back')}
        </Link>
      </Card>
      <Card className="flex flex-col gap-3">
        {loading && <Loading />}
        {failed && (
          <LoadProblem
            heading={title}
            onRetry={() => Promise.all([staffRows.reload(), laborRows.reload()])}
          />
        )}
        {!loading && !failed && cities?.length === 0 && (
          <EmptyState icon={<Users />} title={t('staff.empty')} headingLevel={3} />
        )}
        {!loading && !failed && cities && cities.length > 0 && (
          <ul className="flex flex-col gap-3">
            {cities.map((city) => (
              <li
                key={city.cityId}
                className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-raised p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl">{nameOf(city.cityId)}</h2>
                </div>
                <p>
                  {t('staff.workers', {
                    count: city.workers,
                    number: number.format(city.workers),
                  })}
                </p>
                <p>
                  {t('staff.housing', {
                    housed: number.format(city.housed),
                    unhoused: number.format(city.unhoused),
                  })}
                </p>
                <p className={city.unhoused > 0 ? 'font-semibold' : 'text-muted-foreground'}>
                  {city.lodgingOboles === null
                    ? t('staff.lodgingUnknown')
                    : t('staff.lodging', { cost: money(city.lodgingOboles) })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
