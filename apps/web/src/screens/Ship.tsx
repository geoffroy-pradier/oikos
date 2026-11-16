import { Button, Card } from '@oikos/ui';
import { Link, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useArrivals, useFleet, useShipName, type VoyageRow } from '../fleet';
import { useHouse } from '../house';
import { formatList } from '../lists';
import { LoadProblem, Loading } from './LoadProblem';

/** Fiche d'un navire : où il est, ses voyages (départ, arrivée prévue, cargaison), et son départ (#254). */
export function ShipScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const { shipId } = useParams({ strict: false });
  const fleet = useFleet();
  const ships = fleet.ships.rows;
  const ship = ships?.find((candidate) => candidate.id === shipId);
  const shipName = useShipName(ships ?? []);
  // Les voyages de ce navire, du plus récent au plus ancien.
  const voyages = (fleet.voyages.rows ?? [])
    .filter((voyage) => voyage.ship_id === shipId)
    .reverse();
  const arrivals = useArrivals(fleet.voyages.rows).filter((voyage) => voyage.ship_id === shipId);
  const number = new Intl.NumberFormat(i18n.language);
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const cityName = (cityId: string) => house.cityNames[cityId] ?? cityId;
  const place = ship?.docked_city_id
    ? t('map.docked', { city: cityName(ship.docked_city_id) })
    : t('map.atSeaUnknown');
  const cargoText = (voyage: VoyageRow) =>
    voyage.cargo.length === 0
      ? t('ship.ballast')
      : formatList(
          i18n.language,
          voyage.cargo.map((line) =>
            t('home.stack', {
              quantity: number.format(line.quantity),
              good: t(`goods.${line.goodId}`, { defaultValue: line.goodId }),
            }),
          ),
        );

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/carte"
        className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
      >
        {t('ship.back')}
      </Link>
      {fleet.failed && <LoadProblem onRetry={fleet.reload} />}
      {ships === null && !fleet.failed && <Loading />}
      {ships && !ship && <p role="alert">{t('errors.SHIP_NOT_FOUND')}</p>}
      {ship && (
        <Card>
          <h1 className="text-2xl">{shipName(ship)}</h1>
          <p>{ship.laid_up_at ? t('map.withLaidUp', { state: place }) : place}</p>
          {/* Une arrivée vue à la relecture (chaque minute, ou « Relire ») est annoncée. */}
          {arrivals.map((voyage) => (
            <p key={voyage.id} role="status" className="font-semibold">
              {t('ship.arrived', { city: cityName(voyage.to_city_id), cargo: cargoText(voyage) })}
            </p>
          ))}
          <Button variant="ghost" onClick={() => void fleet.reload()}>
            {t('ship.reload')}
          </Button>
        </Card>
      )}
      {ship && (
        <Card>
          <h2 className="text-xl">{t('ship.voyages')}</h2>
          {voyages.length === 0 && <p className="text-muted-foreground">{t('ship.noVoyages')}</p>}
          <ul className="flex flex-col gap-3">
            {voyages.map((voyage) => (
              <li key={voyage.id}>
                <h3 className="font-semibold">
                  {t('ship.voyage', {
                    from: cityName(voyage.from_city_id),
                    to: cityName(voyage.to_city_id),
                  })}
                </h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3">
                  <dt>{t('ship.departedAt')}</dt>
                  <dd>{time.format(new Date(voyage.departed_at))}</dd>
                  <dt>{voyage.arrived_at ? t('ship.arrivedAt') : t('ship.arrivesAt')}</dt>
                  <dd>{time.format(new Date(voyage.arrived_at ?? voyage.arrives_at))}</dd>
                  <dt>{t('ship.cargo')}</dt>
                  <dd>{cargoText(voyage)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
