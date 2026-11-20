import { CITY_MAP_POSITIONS } from '@oikos/config/client';
import { Anchor, Button, Card, EmptyState, Hammer, PillTabs, Ship, Waves } from '@oikos/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTitle } from './SectionTitle';
import { Help } from './Help';
import { useArrivals, useFleet, useShipName, voyageAtSea, type ShipRow } from '../fleet';
import { parseCityIdentities } from '../city-identity';
import { useCash } from '../cash';
import { useRows, useSiteRules } from '../data';
import { useHouse } from '../house';
import { archipelagoLayout, voyageProgress, type Point } from '../map-layout';
import { formatList } from '../lists';
import { ScreenHeader } from '../ScreenHeader';
import { ArchipelagoMap } from './ArchipelagoMap';
import { AtSea } from './AtSea';
import { CityPanel } from './CityPanel';
import { LoadProblem, Loading } from './LoadProblem';
import { Shipyard } from './Shipyard';
import { dateTimeFormat } from '../game-time';

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
  const time = dateTimeFormat(i18n.language);
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
  // Liste : par cité de départ puis d'arrivée, en colonnes sur un écran large (vingt-trois routes, #707).
  const sortedRoutes = [...routes].sort(
    (a, b) =>
      cityName(a.from).localeCompare(cityName(b.from), i18n.language) ||
      cityName(a.to).localeCompare(cityName(b.to), i18n.language),
  );
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
  // Action principale : faire partir un navire à quai et armé. Un seul : sa fiche, où le départ se prépare ;
  // plusieurs : la flotte, qui les nomme chacun.
  const navigate = useNavigate();
  const fleetTitle = useRef<HTMLHeadingElement>(null);
  const ready = (ships ?? []).filter((ship) => ship.docked_city_id && !ship.laid_up_at);
  const depart = () => {
    const [only, other] = ready;
    if (only && !other) void navigate({ to: '/carte/navire/$shipId', params: { shipId: only.id } });
    else {
      fleetTitle.current?.scrollIntoView({ block: 'start' });
      fleetTitle.current?.focus();
    }
  };
  // Cité du panneau (celle de la maison d'abord) et calque de la carte.
  const [chosen, setChosen] = useState(house.cityId);
  const [layer, setLayer] = useState<'routes' | 'terroirs'>('routes');
  const cityIds = [...slugs.keys()].sort((a, b) => cityName(a).localeCompare(cityName(b)));
  const identityRows = useRows<unknown>(
    'city_identity',
    'city_id, terroir, has_port, patron_god_id, starting_recipe_id',
    'city_id',
    { city_id: [...slugs.keys()].sort() },
  );
  const identities = identityRows.rows ? parseCityIdentities(identityRows.rows) : null;
  const siteRules = useSiteRules().rules;
  const cash = useCash();
  // Biens du terroir d'une cité : le premier extrant de chaque recette admise.
  const goodsOf = (cityId: string) =>
    (identities?.get(cityId)?.terroir ?? []).flatMap((recipeId) => {
      const good = siteRules?.recipe(recipeId)?.outputs[0]?.goodId;
      return good ? [good] : [];
    });

  return (
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <ScreenHeader
        title={t('map.title')}
        action={
          <>
            <PillTabs
              label={t('map.layers')}
              value={layer}
              onValueChange={(id) => setLayer(id === 'terroirs' ? 'terroirs' : 'routes')}
              items={[
                { id: 'routes', label: t('map.layer.routes') },
                { id: 'terroirs', label: t('map.layer.terroirs') },
              ]}
            />
            {ready.length > 0 && fleet.departureRules && (
              <Button icon={<Anchor aria-hidden="true" />} onClick={depart}>
                {t('map.depart')}
              </Button>
            )}
          </>
        }
      >
        <Help>{t('map.intro')}</Help>
      </ScreenHeader>
      {fleet.failed && <LoadProblem onRetry={fleet.reload} />}
      {loading && !fleet.failed && <Loading />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
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
              const selected = cityId === chosen;
              const city = { id: cityId, name: cityName(cityId), home, docked, selected };
              return at ? [{ ...city, at, goods: goodsOf(cityId) }] : [];
            })}
            ships={atSea.flatMap(({ ship, voyage }) => {
              const [from, to] = [pointOf(voyage.from_city_id), pointOf(voyage.to_city_id)];
              const progress = voyageProgress(voyage.departed_at, voyage.arrives_at, now);
              return from && to ? [{ id: ship.id, name: shipName(ship), from, to, progress }] : [];
            })}
            pointOf={pointOf}
            home={pointOf(house.cityId)}
            layer={layer}
            onSelect={setChosen}
          />
        </Card>
        <aside className="flex flex-col gap-4">
          <CityPanel
            cityIds={cityIds}
            cityId={chosen}
            onChange={setChosen}
            cityName={cityName}
            identity={identities?.get(chosen)}
            homeId={house.cityId}
          />
          <AtSea
            voyages={atSea.map(({ ship, voyage }) => ({ ...voyage, name: shipName(ship) }))}
            cityName={cityName}
            now={now}
          />
        </aside>
      </div>

      <Card className="flex flex-col gap-3">
        <SectionTitle icon={<Waves />}>{t('map.routes')}</SectionTitle>
        {rules && routes.length === 0 && (
          <EmptyState compact illustration="noShip" title={t('map.noRoutes')} />
        )}
        {unlinked.length > 0 && (
          <p>
            {t('map.noRouteFor', { cities: formatList(i18n.language, unlinked.map(cityName)) })}
          </p>
        )}
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {sortedRoutes.map(({ from, to, hours: duration }) => (
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
        <SectionTitle ref={fleetTitle} tabIndex={-1} icon={<Anchor />}>
          {t('map.fleet')}
        </SectionTitle>
        {ships?.length === 0 && (
          <EmptyState
            illustration="noShip"
            title={t('map.noShips')}
            action={
              <Button
                icon={<Hammer aria-hidden="true" />}
                variant="secondary"
                onClick={() => document.getElementById('shipyard')?.focus()}
              >
                {t('map.toShipyard')}
              </Button>
            }
          />
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
        balance={cash.balance}
        reloadShips={fleet.ships.reload}
        reloadFleet={() => Promise.all([fleet.reload(), cash.reload()])}
      />
    </div>
  );
}
