import { Card } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { useRows } from '../data';
import { useHouse } from '../house';
import { coverageShare, parseCityPopulation } from '../population';
import { LoadProblem, Loading } from './LoadProblem';

/**
 * Onglet Cité : population de la cité de la maison, classe par classe, et couverture de ses besoins
 * vitaux à la dernière clôture (docs/specs/05-economie.md, 5.2). Lecture seule, vue `city_population`.
 */
export function CityScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const rows = useRows<unknown>(
    'city_population',
    'class_id, population, coverage_bps',
    'class_id',
    {
      city_id: house.cityId,
    },
  );
  const city = rows.rows === null ? null : parseCityPopulation(rows.rows);
  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  const failed = rows.failed || (rows.rows !== null && city === null);
  // Une classe ou un nom ajoutés par le back-office sans traduction s'affichent par leur identifiant.
  const className = (id: string) => t(`npcClasses.${id}`, { defaultValue: id });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h1 className="text-2xl">{t('city.title', { city: house.cityName })}</h1>
        <p className="text-muted-foreground">{t('city.intro')}</p>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">{t('city.population')}</h2>
        {rows.rows === null && !rows.failed && <Loading />}
        {failed && <LoadProblem onRetry={() => rows.reload()} />}
        {city && city.classes.length === 0 && (
          <p className="text-muted-foreground">{t('city.empty')}</p>
        )}
        {city && city.classes.length > 0 && (
          <>
            <p className="text-lg font-semibold">
              {t('city.total', { count: city.total, number: number.format(city.total) })}
            </p>
            <ul className="flex flex-col gap-2">
              {city.classes.map((row) => {
                const share = coverageShare(row);
                return (
                  <li key={row.class_id} className="flex flex-col border-t border-border pt-2">
                    <h3 className="font-semibold">{className(row.class_id)}</h3>
                    <p>
                      {t('city.inhabitants', {
                        count: row.population,
                        number: number.format(row.population),
                      })}
                    </p>
                    <p className="text-muted-foreground">
                      {share === null
                        ? t('city.coverageUnknown')
                        : t('city.coverage', { percent: percent.format(share) })}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
