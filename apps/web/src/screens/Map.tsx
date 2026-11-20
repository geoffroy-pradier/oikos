import { CITY_MAP_POSITIONS } from '@oikos/config/client';
import { Card, MapIcon, Ship, Waves } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useArrivals, useFleet, useShipName, voyageAtSea, type ShipRow } from '../fleet';
import { useHouse } from '../house';
import { archipelagoLayout, voyageProgress, type Point } from '../map-layout';
import { formatList } from '../lists';
import { ArchipelagoMap } from './ArchipelagoMap';
import { LoadProblem, Loading } from './LoadProblem';
import { Shipyard } from './Shipyard';

/** Onglet Carte : l'archipel, ses routes et les navires de la maison, la liste qui les dit, le chantier. */
export function MapScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const fleet = useFleet();
  const { slugs, rules, now } = fleet;
  const ships = fleet.ships.rows;
  const voyages = fleet.voyages.rows ?? [];
  const shipName = useShipName(ships ?? []);
  const arrivals = useArrivals(fleet.voyages.rows);
  const number = new Intl.NumberFormat(i18n.language);
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const cityName = (cityId: string) => house.cityNames[cityId] ?? cityId;
  const idOf = useMemo(() => new Map([...slugs].map(([id, slug]) => [slug, id])), [slugs]);
  const layout = useMemo(() => archipelagoLayout([...slugs.values()], CITY_MAP_POSITIONS), [slugs]);
  const pointOf = (cityId: string): Point | undefined => layout.get(slugs.get(cityId) ?? '');
  // Routes entre cités connues de ce monde ; une route vers une cité inconnue n'est pas dessinée.
  const routes = (rules?.routes ?? []).flatMap(({ cities: [a, b], hours }) => {
    const from = idOf.get(a);
    const to = idOf.get(b);
    return from && to ? [{ from, to, hours }] : [];
  });
  // Cités du monde qu'aucune route ne relie : nommées dans la liste, comme sur le dessin.
  const unlinked = [...slugs.keys()].filter(
    (cityId) => !routes.some(({ from, to }) => from === cityId || to === cityId),
  );
  // Navires en mer et leur voyage en cours.
  const atSea = (ships ?? []).flatMap((ship) => {
    const voyage = ship.docked_city_id ? undefined : voyageAtSea(voyages, ship.id);
    return voyage ? [{ ship, voyage }] : [];
  });
  const hours = (count: number) => t('map.hours', { count, number: number.format(count) });

  const stateOf = (ship: ShipRow) => {
    const voyage = voyageAtSea(voyages, ship.id);
    const state = ship.docked_city_id
      ? t('map.docked', { city: cityName(ship.docked_city_id) })
      : voyage
        ? t('map.atSea', {
            city: cityName(voyage.to_city_id),
            time: time.format(new Date(voyage.arrives_at)),
          })
        : t('map.atSeaUnknown');
    return ship.laid_up_at ? t('map.withLaidUp', { state }) : state;
  };
  const loading = ships === null || rules === null;

  return (
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <Card elevation="raised" className="overflow-hidden p-0">
        <div className="flex flex-col gap-1 p-4">
          <h1 className="flex items-center gap-2 text-2xl">
            <MapIcon aria-hidden="true" className="size-6 shrink-0 text-aegean" />
            {t('map.title')}
          </h1>
          <p className="text-muted-foreground">{t('map.intro')}</p>
        </div>
      </Card>
      {fleet.failed && <LoadProblem onRetry={fleet.reload} />}
      {loading && !fleet.failed && <Loading />}

      <Card className="overflow-hidden border-coast p-0">
        <ArchipelagoMap
          label={t('map.drawing', {
            cities: number.format(layout.size),
            routes: number.format(routes.length),
          })}
          routes={routes.map((route) => ({
            ...route,
            ours: atSea.some(
              ({ voyage }) =>
                [voyage.from_city_id, voyage.to_city_id].sort().join() ===
                [route.from, route.to].sort().join(),
            ),
          }))}
          cities={[...slugs.keys()].flatMap((cityId) => {
            const at = pointOf(cityId);
            const docked = (ships ?? []).filter((ship) => ship.docked_city_id === cityId).length;
            const home = cityId === house.cityId;
            return at ? [{ id: cityId, name: cityName(cityId), at, home, docked }] : [];
          })}
          ships={atSea.flatMap(({ ship, voyage }) => {
            const [from, to] = [pointOf(voyage.from_city_id), pointOf(voyage.to_city_id)];
            const progress = voyageProgress(voyage.departed_at, voyage.arrives_at, now);
            return from && to ? [{ id: ship.id, name: shipName(ship), from, to, progress }] : [];
          })}
          pointOf={pointOf}
        />
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">{t('map.routes')}</h2>
        {rules && routes.length === 0 && (
          <p className="text-muted-foreground">{t('map.noRoutes')}</p>
        )}
        {unlinked.length > 0 && (
          <p>
            {t('map.noRouteFor', { cities: formatList(i18n.language, unlinked.map(cityName)) })}
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {routes.map(({ from, to, hours: duration }) => (
            <li key={`${from}-${to}`} className="flex items-center gap-2">
              <Waves aria-hidden="true" className="size-4 shrink-0 text-aegean" />
              {t('map.route', {
                from: cityName(from),
                to: cityName(to),
                duration: hours(duration),
              })}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">{t('map.fleet')}</h2>
        {ships?.length === 0 && (
          <p className="rounded-lg border border-dashed border-border-subtle p-4 text-muted-foreground">
            {t('map.noShips')}
          </p>
        )}
        {/* Arrivées vues à la relecture (chaque minute) : annoncées. */}
        {arrivals.map((voyage) => (
          <p
            key={voyage.id}
            role="status"
            className="rounded-lg bg-success-subtle p-3 font-semibold text-foreground"
          >
            {t('map.arrived', { city: cityName(voyage.to_city_id) })}
          </p>
        ))}
        <ul className="flex flex-col gap-2">
          {(ships ?? []).map((ship) => (
            <li key={ship.id} className="flex items-start gap-2 rounded-lg bg-muted/40 p-3">
              <Ship aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-aegean" />
              <span>
                <Link
                  to="/carte/navire/$shipId"
                  params={{ shipId: ship.id }}
                  className="font-semibold text-primary underline underline-offset-4"
                >
                  {shipName(ship)}
                </Link>
                {t('map.afterName', { state: stateOf(ship) })}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Shipyard
        ships={ships}
        rules={rules}
        reloadShips={fleet.ships.reload}
        reloadFleet={fleet.reload}
      />
    </div>
  );
}
