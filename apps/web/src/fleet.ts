import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows, useShipRules } from './data';
import { useHouse } from './house';
import { serverClock, syncServerClock } from './server-clock';

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
 * par identifiant de cité, lus avec la maison), les règles du transport, les navires et les voyages de la maison, et l'heure
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
  useEffect(() => {
    let live = true;
    void syncServerClock().then(() => live && setNow(serverClock.now()));
    const timer = setInterval(() => setNow(serverClock.now()), 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  // Cités du monde de la maison, lues avec elle (`App.tsx`) : la table les rend toutes, au-delà d'une page.
  const slugs = useMemo(() => new Map(Object.entries(house.citySlugs ?? {})), [house.citySlugs]);
  const failed = rules.failed || ships.failed || voyages.failed;
  const reload = () => Promise.all([rules.reload(), ships.reload(), voyages.reload()]);
  return { slugs, rules: rules.rules, ships, voyages, now, failed, reload };
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
