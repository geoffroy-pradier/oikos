import { Card, MapIcon, Ship, Waves } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useArrivals, useFleet, useShipName, voyageAtSea, type ShipRow } from '../fleet';
import { useHouse } from '../house';
import {
  along,
  archipelagoLayout,
  MAP_HEIGHT,
  MAP_WIDTH,
  voyageProgress,
  type Point,
} from '../map-layout';
import { formatList } from '../lists';
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
  const layout = useMemo(() => archipelagoLayout([...slugs.values()]), [slugs]);
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

      <Card className="flex flex-col gap-3">
        {/* Dessin schématique : la liste qui suit porte les mêmes informations, au clavier. */}
        <svg
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          role="img"
          aria-label={t('map.drawing', {
            cities: number.format(layout.size),
            routes: number.format(routes.length),
          })}
          className="mx-auto max-h-[32rem] w-full rounded-lg bg-aegean-subtle"
        >
          {routes.map(({ from, to, hours: duration }) => {
            const a = pointOf(from);
            const b = pointOf(to);
            if (!a || !b) return null;
            const middle = along(a, b, 0.5);
            return (
              <g key={`${from}-${to}`}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className="stroke-primary"
                  strokeWidth={0.4}
                  strokeDasharray="1.5 1"
                />
                <text
                  x={middle.x}
                  y={middle.y - 1}
                  textAnchor="middle"
                  fontSize={3.2}
                  className="fill-foreground stroke-aegean-subtle"
                  strokeWidth={1.2}
                  style={{ paintOrder: 'stroke' }}
                >
                  {hours(duration)}
                </text>
              </g>
            );
          })}
          {[...slugs].map(([cityId]) => {
            const point = pointOf(cityId);
            if (!point) return null;
            const docked = (ships ?? []).filter((ship) => ship.docked_city_id === cityId).length;
            return (
              <g key={cityId}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={2.6}
                  className="fill-primary stroke-primary/25"
                  strokeWidth={3}
                />
                <text
                  x={point.x}
                  y={point.y + 6}
                  textAnchor="middle"
                  fontSize={4}
                  className="fill-foreground stroke-aegean-subtle font-semibold"
                  strokeWidth={1.2}
                  style={{ paintOrder: 'stroke' }}
                >
                  {cityName(cityId)}
                  {docked > 0 && ` ⚓${number.format(docked)}`}
                </text>
              </g>
            );
          })}
          {(ships ?? []).map((ship) => {
            const voyage = ship.docked_city_id ? undefined : voyageAtSea(voyages, ship.id);
            const a = voyage && pointOf(voyage.from_city_id);
            const b = voyage && pointOf(voyage.to_city_id);
            if (!voyage || !a || !b) return null;
            const at = along(a, b, voyageProgress(voyage.departed_at, voyage.arrives_at, now));
            return (
              <circle
                key={ship.id}
                cx={at.x}
                cy={at.y}
                r={1.4}
                className="fill-accent stroke-foreground"
                strokeWidth={0.3}
              />
            );
          })}
        </svg>

        <h2 className="mt-1 text-xl">{t('map.routes')}</h2>
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
