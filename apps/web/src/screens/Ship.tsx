import { Anchor, Badge, Button, Card, CircleAlert, Info } from '@oikos/ui';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useArrivals, useFleet, useShipName, type VoyageRow } from '../fleet';
import { useHouse } from '../house';
import { formatList } from '../lists';
import { Departure, type DepartureNotice } from './Departure';
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
  const voyageRows = fleet.voyages.rows;
  const voyageCounts = useMemo(() => {
    if (!voyageRows) return null;
    const counts = new Map<string, number>();
    for (const row of voyageRows) counts.set(row.ship_id, (counts.get(row.ship_id) ?? 0) + 1);
    return counts;
  }, [voyageRows]);
  const [notice, setNotice] = useState<DepartureNotice | null>(null);
  // Un départ réussi retire le formulaire, et son bouton avec lui : le foyer, retombé sur la page, va au
  // message qui annonce l'issue (comme sur l'écran des sites).
  const noticeElement = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active === document.body || active?.matches(':disabled') === true)
      noticeElement.current?.focus();
  }, [notice]);
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
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <Link
        to="/carte"
        className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-primary underline underline-offset-4"
      >
        {t('ship.back')}
      </Link>
      {fleet.failed && <LoadProblem onRetry={fleet.reload} />}
      {ships === null && !fleet.failed && <Loading />}
      {ships && !ship && (
        <p role="alert" className="rounded-lg bg-danger-subtle p-3 font-semibold text-danger">
          {t('errors.SHIP_NOT_FOUND')}
        </p>
      )}
      {ship && (
        <Card elevation="raised" className="flex flex-col gap-3 overflow-hidden p-0">
          <div className="flex flex-col gap-3 p-4">
            <h1 className="text-2xl">{shipName(ship)}</h1>
            <p>
              <Badge tone="aegean" icon={<Anchor aria-hidden="true" />}>
                {ship.laid_up_at ? t('map.withLaidUp', { state: place }) : place}
              </Badge>
            </p>
            {/* Une arrivée vue à la relecture (chaque minute, ou « Relire ») est annoncée. */}
            {arrivals.map((voyage) => (
              <p
                key={voyage.id}
                role="status"
                className="rounded-lg bg-success-subtle p-3 font-semibold text-foreground"
              >
                {t('ship.arrived', { city: cityName(voyage.to_city_id), cargo: cargoText(voyage) })}
              </p>
            ))}
            {notice && (
              <p
                ref={noticeElement}
                tabIndex={-1}
                role={notice.kind}
                className={
                  'flex items-start gap-2 rounded-lg p-3 ' +
                  (notice.kind === 'alert'
                    ? 'bg-danger-subtle font-semibold text-danger'
                    : 'bg-success-subtle text-foreground')
                }
              >
                {notice.kind === 'alert' ? (
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                ) : (
                  <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                )}
                {notice.text}
              </p>
            )}
            <Button variant="secondary" className="self-start" onClick={() => void fleet.reload()}>
              {t('ship.reload')}
            </Button>
          </div>
        </Card>
      )}
      {ship?.docked_city_id && !ship.laid_up_at && fleet.departureRules && (
        <Card className="flex flex-col gap-3">
          <Departure
            ship={{ ...ship, docked_city_id: ship.docked_city_id }}
            shipName={shipName(ship)}
            rules={fleet.departureRules}
            slugs={fleet.slugs}
            voyageCounts={voyageCounts}
            onDone={(next) => {
              setNotice(next);
              return fleet.reload();
            }}
          />
        </Card>
      )}
      {ship && (
        <Card>
          <h2 className="mb-3 text-xl">{t('ship.voyages')}</h2>
          {voyages.length === 0 && (
            <p className="rounded-lg border border-dashed border-border-subtle p-4 text-muted-foreground">
              {t('ship.noVoyages')}
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {voyages.map((voyage) => (
              <li key={voyage.id} className="rounded-lg bg-muted/40 p-3">
                <h3 className="font-semibold">
                  {t('ship.voyage', {
                    from: cityName(voyage.from_city_id),
                    to: cityName(voyage.to_city_id),
                  })}
                </h3>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 [&>dt]:text-muted-foreground">
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
