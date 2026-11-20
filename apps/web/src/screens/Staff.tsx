import {
  Card,
  Coins,
  DataTable,
  EmptyState,
  House,
  StatCard,
  StatGrid,
  Users,
  type DataColumn,
} from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useHouse } from '../house';
import { HouseNav } from '../HouseNav';
import { parseCityLabor, staffByCity, type CityStaff } from '../labor';
import { useMoney } from '../money';
import { ScreenHeader } from '../ScreenHeader';
import { LoadProblem, Loading } from './LoadProblem';

const COUNTS = ['workers', 'housed', 'unhoused'] as const;

/**
 * Personnel de la maison (4.4, 4.5) : les travailleurs de ses sites, cité par cité, logés par ses biens
 * ou non, et ce que coûte chaque jour l'hébergement des autres chez les PNJ, au prix du jour de la cité
 * (vues `my_workforce` et `labor_market`). Lecture seule : les totaux en cartes, puis les cités en
 * tableau (fiches sur téléphone).
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
  const shown = !loading && !failed && cities && cities.length > 0 ? cities : null;
  const total = (pick: (city: CityStaff) => number) =>
    (shown ?? []).reduce((sum, city) => sum + pick(city), 0);
  // Une cité dont le prix n'est pas encore fixé n'entre pas dans le total, qui le dit.
  const unpriced = (shown ?? []).filter((city) => city.lodgingOboles === null).length;
  const columns: DataColumn<CityStaff>[] = [
    {
      id: 'city',
      header: t('staff.city'),
      cell: (city) => nameOf(city.cityId),
      sortValue: (city) => nameOf(city.cityId),
    },
    ...COUNTS.map((key) => ({
      id: key,
      header: t(`staff.columns.${key}`),
      cell: (city: CityStaff) => number.format(city[key]),
      sortValue: (city: CityStaff) => city[key],
      numeric: true,
    })),
    {
      id: 'lodging',
      header: t('staff.columns.lodging'),
      cell: (city) =>
        city.lodgingOboles === null ? t('staff.lodgingPending') : money(city.lodgingOboles),
      sortValue: (city) => city.lodgingOboles,
      numeric: true,
    },
  ];
  const icons = { workers: <Users />, housed: <House />, unhoused: <Users /> };

  return (
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <ScreenHeader title={t('staff.title')} titleRef={title} />
      <HouseNav />
      <p className="max-w-3xl text-sm text-muted-foreground">{t('staff.intro')}</p>
      {loading && <Loading />}
      {failed && (
        <LoadProblem
          heading={title}
          onRetry={() => Promise.all([staffRows.reload(), laborRows.reload()])}
        />
      )}
      {!loading && !failed && cities?.length === 0 && (
        <Card>
          <EmptyState icon={<Users />} title={t('staff.empty')} headingLevel={2} />
        </Card>
      )}
      {shown && (
        <>
          <StatGrid as="ul" aria-label={t('staff.figures')}>
            {COUNTS.map((key) => (
              <li key={key}>
                <StatCard
                  label={t(`staff.columns.${key}`)}
                  icon={icons[key]}
                  value={number.format(total((city) => city[key]))}
                />
              </li>
            ))}
            <li>
              <StatCard
                label={t('staff.columns.lodging')}
                icon={<Coins />}
                value={
                  unpriced === shown.length ? '—' : money(total((city) => city.lodgingOboles ?? 0))
                }
                hint={
                  unpriced === shown.length
                    ? t('staff.lodgingNext')
                    : unpriced > 0
                      ? t('staff.lodgingPartial', { count: unpriced })
                      : t('staff.lodgingHint')
                }
              />
            </li>
          </StatGrid>
          <Card className="flex flex-col gap-3" aria-labelledby="staff-cities">
            <h2 id="staff-cities" className="text-lg font-semibold">
              {t('staff.byCity')}
            </h2>
            <DataTable
              caption={t('staff.byCity')}
              columns={columns}
              rows={shown}
              rowKey={(city) => city.cityId}
              defaultSort={{ column: 'city', direction: 'ascending' }}
              locale={i18n.language}
              sortAnnouncement={(column, direction) =>
                t(
                  direction === 'ascending'
                    ? 'accounts.sortedAscending'
                    : 'accounts.sortedDescending',
                  {
                    column,
                  },
                )
              }
            />
            {unpriced > 0 && (
              <p className="text-sm text-muted-foreground">{t('staff.lodgingUnknown')}</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
