import { Amphora, Bird, Card, Frieze, Hammer, House, Landmark, Users } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { describeCity, parseCityIdentities } from '../city-identity';
import { useRows } from '../data';
import { useHouse } from '../house';
import { employmentShare, parseCityLabor } from '../labor';
import { useMoney } from '../money';
import { parkBySize } from '../property';
import { coverageShare, parseCityPopulation } from '../population';
import { CityAssembly } from './CityAssembly';
import { CityChronicle } from './CityChronicle';
import { CityEvents } from './CityEvents';
import { CityPolitics } from './CityPolitics';
import { CityTreasury } from './CityTreasury';
import { LoadProblem, Loading } from './LoadProblem';

/**
 * Onglet Cité : identité de la cité de la maison (6.1, vue `city_identity`), puis sa population, classe
 * par classe, et la couverture de ses besoins vitaux à la dernière clôture (docs/specs/05-economie.md,
 * 5.2, vue `city_population`), sa chronique (6.6), ses événements en cours (7.4). Lecture seule.
 */
export function CityScreen() {
  const { t, i18n } = useTranslation();
  // Titre de la carte : le foyer y va après une relecture réussie.
  const title = useRef<HTMLHeadingElement>(null);
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
  const identityTitle = useRef<HTMLHeadingElement>(null);
  const read = useRows<unknown>(
    'city_identity',
    'city_id, terroir, has_port, patron_god_id, starting_recipe_id',
    'city_id',
    { city_id: house.cityId },
  );
  const identities = read.rows === null ? null : parseCityIdentities(read.rows);
  const identity = identities?.get(house.cityId);
  const lines = identity ? describeCity(identity, t, i18n.language) : null;
  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  const failed = rows.failed || (rows.rows !== null && city === null);
  // Marché du travail du jour de la cité (4.4) et son parc de logements (4.5).
  const money = useMoney();
  const laborTitle = useRef<HTMLHeadingElement>(null);
  const laborRows = useRows<unknown>(
    'labor_market',
    'city_id, game_day, supply, employed, unhoused, wage_oboles, lodging_oboles',
    'city_id',
    { city_id: house.cityId },
  );
  const laborMap = laborRows.rows === null ? undefined : parseCityLabor(laborRows.rows);
  const labor = laborMap?.get(house.cityId);
  const employment = labor ? employmentShare(labor) : null;
  const parkTitle = useRef<HTMLHeadingElement>(null);
  const parkRows = useRows<unknown>('city_properties', 'id, size_id, for_sale', 'size_id', {
    city_id: house.cityId,
  });
  const park = parkRows.rows === null ? undefined : parkBySize(parkRows.rows);
  const sizeName = (id: string) => t(`propertySizes.${id}`, { defaultValue: id });
  // Une classe ou un nom ajoutés par le back-office sans traduction s'affichent par leur identifiant.
  const className = (id: string) => t(`npcClasses.${id}`, { defaultValue: id });

  return (
    <div className="flex flex-col gap-4">
      <Card elevation="raised" className="overflow-hidden p-0">
        <Frieze tone="accent" />
        <div className="flex flex-col gap-1 p-4">
          {/* Icône dans le fil du texte, pas en flex : à police très agrandie, le titre se replie sans déborder. */}
          <h1 className="text-2xl">
            <Landmark
              aria-hidden="true"
              className="mr-2 inline size-6 align-[-0.15em] text-accent"
            />
            {t('city.title', { city: house.cityName })}
          </h1>
          <p className="text-muted-foreground">{t('city.intro')}</p>
          <Link
            to="/cite/temple"
            className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
          >
            <Amphora aria-hidden="true" className="mr-2 inline size-4" />
            {t('city.templeLink')}
          </Link>
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 ref={identityTitle} tabIndex={-1} className="text-xl">
          <Bird aria-hidden="true" className="mr-2 inline size-5 align-[-0.15em] text-accent" />
          {t('cityIdentity.title')}
        </h2>
        {read.rows === null && !read.failed && <Loading />}
        {(read.failed || (read.rows !== null && identities === null)) && (
          <LoadProblem heading={identityTitle} onRetry={() => read.reload()} />
        )}
        {identities && !lines && (
          <p className="text-muted-foreground">{t('cityIdentity.missing')}</p>
        )}
        {lines && (
          <ul className="flex list-inside list-disc flex-col gap-1 marker:text-accent">
            {[lines.god, lines.port, lines.terroir, lines.start].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </Card>
      <CityChronicle />
      <CityEvents />
      <CityPolitics />
      <CityAssembly />
      <CityTreasury />
      <Card className="flex flex-col gap-3">
        <h2 ref={laborTitle} tabIndex={-1} className="text-xl">
          <Hammer aria-hidden="true" className="mr-2 inline size-5 align-[-0.15em] text-accent" />
          {t('city.labor.title')}
        </h2>
        {laborRows.rows === null && !laborRows.failed && <Loading />}
        {(laborRows.failed || laborMap === null) && (
          <LoadProblem heading={laborTitle} onRetry={() => laborRows.reload()} />
        )}
        {laborMap && !labor && <p className="text-muted-foreground">{t('city.labor.none')}</p>}
        {labor && (
          <ul className="flex flex-col gap-1">
            <li>{t('city.labor.wage', { cost: money(labor.wageOboles) })}</li>
            <li>
              {employment === null
                ? t('city.labor.unlimited', {
                    count: labor.employed,
                    employed: number.format(labor.employed),
                  })
                : t('city.labor.employment', {
                    count: labor.employed,
                    percent: percent.format(employment),
                    employed: number.format(labor.employed),
                    supply: number.format(labor.supply),
                  })}
            </li>
            <li>{t('city.labor.lodging', { cost: money(labor.lodgingOboles) })}</li>
            <li>{t('city.labor.unhoused', { number: number.format(labor.unhoused) })}</li>
          </ul>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 ref={parkTitle} tabIndex={-1} className="text-xl">
          <House aria-hidden="true" className="mr-2 inline size-5 align-[-0.15em] text-accent" />
          {t('city.park.title')}
        </h2>
        {parkRows.rows === null && !parkRows.failed && <Loading />}
        {(parkRows.failed || park === null) && (
          <LoadProblem heading={parkTitle} onRetry={() => parkRows.reload()} />
        )}
        {park?.length === 0 && <p className="text-muted-foreground">{t('city.park.empty')}</p>}
        {park && park.length > 0 && (
          <ul className="flex flex-col gap-1">
            {park.map((size) => (
              <li key={size.sizeId}>
                {t('city.park.size', {
                  size: sizeName(size.sizeId),
                  total: number.format(size.total),
                  forSale: number.format(size.forSale),
                })}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 ref={title} tabIndex={-1} className="text-xl">
          <Users aria-hidden="true" className="mr-2 inline size-5 align-[-0.15em] text-accent" />
          {t('city.population')}
        </h2>
        {rows.rows === null && !rows.failed && <Loading />}
        {failed && <LoadProblem heading={title} onRetry={() => rows.reload()} />}
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
                  <li key={row.class_id} className="flex flex-col rounded-lg bg-muted/50 p-3">
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
