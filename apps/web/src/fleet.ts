import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows, useShipRules } from './data';
import { useHouse } from './house';
import { serverClock, syncServerClock } from './server-clock';
import { withCityCoefficients } from './ship-rules';

/** Un navire de la maison (vue `my_ships`) : à quai dans une cité, ou en mer (`docked_city_id` nul). */
export interface ShipRow {
  id: string;
  class_id: string;
  docked_city_id: string | null;
  laid_up_at: string | null;
}
/** Un voyage de la maison (vue `my_voyages`), cargaison comprise. */
export interface VoyageRow {
  id: string;
  ship_id: string;
  from_city_id: string;
  to_city_id: string;
  departed_at: string;
  arrives_at: string;
  arrived_at: string | null;
  cargo: { goodId: string; quantity: number }[];
}

/**
 * Ce que montrent la carte et les fiches : les cités du monde de la maison (identifiant de configuration
 * par identifiant de cité, lus avec la maison), les règles du transport (et, pour le départ, au droit de port
 * en vigueur de chaque cité), les navires et les voyages de la maison, et l'heure
 * du serveur, relue chaque minute pour avancer les navires en mer.
 */
export function useFleet() {
  const house = useHouse();
  const rules = useShipRules();
  const ships = useRows<ShipRow>('my_ships', 'id, class_id, docked_city_id, laid_up_at', 'id');
  const voyages = useRows<VoyageRow>(
    'my_voyages',
    'id, ship_id, from_city_id, to_city_id, departed_at, arrives_at, arrived_at, cargo',
    'departed_at',
  );
  const [now, setNow] = useState(() => serverClock.now());
  // Chaque minute, onglet visible, et au retour sur l'onglet : l'heure avance, navires et voyages sont
  // relus (une arrivée paraît).
  const reloadShips = ships.reload;
  const reloadVoyages = voyages.reload;
  useEffect(() => {
    let live = true;
    void syncServerClock().then(() => live && setNow(serverClock.now()));
    const reread = () => {
      setNow(serverClock.now());
      if (document.visibilityState !== 'visible') return;
      void reloadShips();
      void reloadVoyages();
    };
    const timer = setInterval(reread, 60_000);
    // Au retour sur l'onglet (minuterie ralentie en arrière-plan), relu aussitôt.
    document.addEventListener('visibilitychange', reread);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', reread);
    };
  }, [reloadShips, reloadVoyages]);
  // Cités du monde de la maison, lues avec elle (`App.tsx`) : la table les rend toutes, au-delà d'une page.
  const slugs = useMemo(() => new Map(Object.entries(house.citySlugs ?? {})), [house.citySlugs]);
  // Droit de port en vigueur de chaque cité (décrets, 5.6) : seul le départ en a besoin, et il attend de
  // l'avoir lu plutôt que d'annoncer le coefficient de la configuration. Les seules cités du monde de la
  // maison : la vue les rend toutes, au-delà d'une page.
  const cityIds = useMemo(() => [...slugs.keys()].sort(), [slugs]);
  const cityRates = useRows<unknown>(
    'city_rates',
    'city_id, port_dues_coefficient_bps',
    'city_id',
    {
      city_id: cityIds,
    },
  );
  const departureRules = useMemo(
    () =>
      rules.rules && cityRates.rows && cityIds.length > 0
        ? withCityCoefficients(rules.rules, cityRates.rows, slugs)
        : null,
    [rules.rules, cityRates.rows, cityIds, slugs],
  );
  const failed =
    rules.failed ||
    ships.failed ||
    voyages.failed ||
    cityRates.failed ||
    (rules.rules !== null &&
      cityRates.rows !== null &&
      cityIds.length > 0 &&
      departureRules === null);
  const reload = () =>
    Promise.all([rules.reload(), ships.reload(), voyages.reload(), cityRates.reload()]);
  return { slugs, rules: rules.rules, departureRules, ships, voyages, now, failed, reload };
}

/** Nom d'un navire : sa classe, numérotée quand la maison en a plusieurs de la même classe. */
export function useShipName(ships: readonly ShipRow[]) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  return (ship: ShipRow) => {
    const name = t(`shipClasses.${ship.class_id}`, { defaultValue: ship.class_id });
    const alike = ships.filter((other) => other.class_id === ship.class_id);
    return alike.length < 2
      ? name
      : t('map.shipNumbered', { ship: name, number: number.format(alike.indexOf(ship) + 1) });
  };
}

/** Voyage en cours d'un navire en mer : le dernier parti et pas encore arrivé. */
export const voyageAtSea = (voyages: readonly VoyageRow[], shipId: string) =>
  voyages.findLast((voyage) => voyage.ship_id === shipId && voyage.arrived_at === null);

/**
 * Voyages arrivés depuis la lecture précédente : en mer à une lecture, arrivés à la suivante. La première
 * lecture n'annonce rien (un voyage déjà arrivé se lit dans la liste). Le dernier lot reste annoncé
 * jusqu'à la relecture suivante qui en apporte un autre.
 */
export function useArrivals(voyages: readonly VoyageRow[] | null): VoyageRow[] {
  const atSea = useRef<Set<string> | null>(null);
  const [arrived, setArrived] = useState<VoyageRow[]>([]);
  useEffect(() => {
    if (!voyages) return;
    const before = atSea.current;
    atSea.current = new Set(voyages.filter((v) => v.arrived_at === null).map((v) => v.id));
    const landed = before ? voyages.filter((v) => v.arrived_at !== null && before.has(v.id)) : [];
    if (landed.length > 0) setArrived(landed);
  }, [voyages]);
  return arrived;
}
