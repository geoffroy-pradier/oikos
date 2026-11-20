import { fairWindSeconds, graceToConsume, stormDurationSeconds } from '@oikos/sim';
import { Anchor, cn, Stepper } from '@oikos/ui';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { departVoyage } from '../api';
import { useRows } from '../data';
import { parseGraceUses, pendingGraces } from '../graces';
import type { ShipRow } from '../fleet';
import { useHouse } from '../house';
import { formatList } from '../lists';
import { useMoney } from '../money';
import { countedIntent, countedIntentBelow, pendingKeys, sendUnderKey } from '../pending-keys';
import { destinationsFrom, quoteDeparture, type ShipRules } from '../ship-rules';
import { describeWorldEvent, stormOn, useWorldEvents } from '../world-events';
import { LoadProblem } from './LoadProblem';

interface Inventory {
  city_id: string;
  good_id: string;
  quantity: number;
  reserved: number;
}
export type DepartureNotice = { kind: 'status' | 'alert'; text: string };
/** Ligne d'option : cible tactile de 44 px, dans un cadre qui se remplit au survol. */
const ROW =
  'flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 py-1 rounded-lg border border-border-subtle bg-surface-raised px-3 ' +
  'transition-colors duration-(--motion-fast) hover:bg-muted';
const WARNING = 'rounded-lg bg-danger-subtle p-3 font-semibold text-danger';

const GRACE_COLUMNS =
  'id, house_id, grace_id, god_id, effect, magnitude_bps, charis_spent, invoked_at, ready_at, consumed_at';

/**
 * Départ d'un navire à quai (4.6) : une destination, une cargaison prise dans le stock libre de la cité
 * (facultative : sans cargaison, le navire part sur lest), le coût annoncé avant l'envoi. Par étapes, dans la
 * feuille de la fiche : la destination, la cargaison, puis le récapitulatif au coût vu et « Partir ».
 */
export function Departure(props: {
  ship: ShipRow & { docked_city_id: string };
  shipName: string;
  rules: ShipRules;
  slugs: ReadonlyMap<string, string>;
  /** Voyages de la maison, par navire : le compte qui rend caduque la clé d'un départ abouti. */
  voyageCounts: ReadonlyMap<string, number> | null;
  onDone: (notice: DepartureNotice) => Promise<unknown>;
  /** Requête en vol : la feuille ne se ferme pas, pour que son issue y soit dite. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { ship, rules, slugs, voyageCounts } = props;
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const number = new Intl.NumberFormat(i18n.language);
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const hours = (seconds: number) => number.format(Math.round((seconds / 3600) * 10) / 10);
  // Secondes retirées par un vent favorable ; arrondies à « 0 h », elles sont dites « quelques minutes au plus ».
  const saved = (seconds: number, key: 'fairWind' | 'sailedWind', god?: string) =>
    t(hours(seconds) === hours(0) ? `departure.${key}Slight` : `departure.${key}`, {
      saved: hours(seconds),
      god: god && t(`gods.${god}`, { defaultValue: god }),
    });
  // Titre de la carte : le foyer y va après un « Réessayer » réussi.
  const title = useRef<HTMLHeadingElement>(null);
  const stock = useRows<Inventory>(
    'my_inventories',
    'city_id, good_id, quantity, reserved',
    'good_id',
    { city_id: ship.docked_city_id },
  );
  const free = (stock.rows ?? [])
    .map((line) => ({ goodId: line.good_id, free: line.quantity - line.reserved }))
    .filter((line) => line.free > 0);
  const idOf = new Map([...slugs].map(([id, slug]) => [slug, id]));
  const fromSlug = slugs.get(ship.docked_city_id) ?? '';
  // Tempêtes en cours dans le monde de la maison, à l'heure du serveur (7.4, #417) : un départ sur leur route
  // dure plus longtemps, comme l'API le comptera. Tant qu'elles ne sont pas lues, la durée est celle du calme.
  const storms = useWorldEvents({ model: 'storm', city_id: [...slugs.keys()].sort() });
  // Vents favorables en attente de la maison (7.1, #477) : le départ consommera le plus ancien, s'il retire au
  // moins une seconde à la durée allongée par la tempête, comme l'API. Tant qu'ils ne sont pas lus, aucun vent.
  const graces = useRows<unknown>('my_graces', GRACE_COLUMNS, 'invoked_at', {
    house_id: house.id,
    effect: 'fair_wind',
  });
  const uses = graces.rows === null ? null : parseGraceUses(graces.rows, house.id);
  const winds = uses && pendingGraces(uses, 'fair_wind');
  const windsFailed = graces.failed || (graces.rows !== null && uses === null);
  const destinations = destinationsFrom(rules, fromSlug).flatMap(({ slug }) => {
    const cityId = idOf.get(slug);
    const quote = cityId && quoteDeparture(rules, ship.class_id, fromSlug, slug);
    if (!cityId || !quote) return [];
    const storm = stormOn(storms.events ?? [], ship.docked_city_id, cityId);
    const stormy = storm
      ? stormDurationSeconds(quote.durationSeconds, storm.magnitudeBps)
      : quote.durationSeconds;
    const wind = graceToConsume(
      winds ?? [],
      'fair_wind',
      (grace) => fairWindSeconds(stormy, grace.magnitudeBps) < stormy,
    );
    const seconds = wind ? fairWindSeconds(stormy, wind.magnitudeBps) : stormy;
    // Allongée (ou raccourcie), mais égale une fois arrondie : la durée n'est pas annoncée comme changée.
    const longer = hours(stormy) !== hours(quote.durationSeconds);
    const shorter = hours(seconds) !== hours(stormy);
    return [{ cityId, quote, storm, stormy, wind, seconds, longer, shorter }];
  });
  const capacity = rules.classes.find((row) => row.id === ship.class_id)?.capacityUnits ?? 0;
  const [to, setTo] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const cargo = free.flatMap(({ goodId, free: available }) => {
    const quantity = Number(quantities[goodId] ?? '0');
    return Number.isInteger(quantity) && quantity > 0 ? [{ goodId, quantity, available }] : [];
  });
  const loaded = cargo.reduce((sum, line) => sum + line.quantity, 0);
  const overStock = cargo.some((line) => line.quantity > line.available);
  const blocked = loaded > capacity || overStock;
  const chosen = destinations.find((destination) => destination.cityId === to);

  // Clé d'un départ sans réponse gardée jusqu'à la relecture qui montre un voyage de plus. Portée
  // disjointe de celle des sites (`oikos.pending.<maison>.`), partagée avec le chantier naval.
  const pending = useMemo(
    () => pendingKeys(`ships.${house.id}`, () => window.sessionStorage),
    [house.id],
  );
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  // Refus ou réponse perdue : dit dans la feuille, près de « Partir », qui reste ouvert.
  const [failure, setFailure] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!voyageCounts || running.current) return;
    pending.settleWhere(countedIntentBelow('depart', (shipId) => voyageCounts.get(shipId) ?? 0));
  }, [pending, voyageCounts]);

  async function depart() {
    const intent = countedIntent(
      'depart',
      ship.id,
      voyageCounts ? (voyageCounts.get(ship.id) ?? 0) : null,
    );
    if (!chosen || intent === null || blocked || running.current) return;
    running.current = true;
    setBusy(true);
    props.onBusyChange?.(true);
    setFailure(null);
    try {
      const input = {
        shipId: ship.id,
        fromCityId: ship.docked_city_id,
        toCityId: chosen.cityId,
        cargo: cargo.map(({ goodId, quantity }) => ({ goodId, quantity })),
        expectedCostOboles: chosen.quote.totalOboles,
      };
      // Sans réponse, la même saisie repart sous la même clé ; un refus (prix changé) : demande neuve au
      // coût relu. Une autre saisie (destination, cargaison ou coût) que l'essai resté sans réponse est
      // une autre demande : sa clé est rendue, jamais l'ancienne entrée envoyée à sa place. Si l'essai a
      // abouti, le navire est en mer et la nouvelle demande est refusée (`SHIP_AT_SEA`) : un seul départ.
      const fresh = () => crypto.randomUUID();
      const waiting = pending.entryFor(intent, fresh, input);
      if (JSON.stringify(waiting.input) !== JSON.stringify(input)) pending.settle(intent);
      const result = await sendUnderKey(
        pending,
        intent,
        fresh,
        input,
        (key, sent) => departVoyage(sent ?? input, house.accessToken, key),
        true,
      );
      if (result.ok) setQuantities({});
      else setFailure(t([`errors.${result.error.code}`, 'errors.INTERNAL']));
      // Relu après toute issue : un refus (stock insuffisant) a pu venir d'un stock changé entre-temps, un
      // départ sans réponse a pu consommer le vent favorable.
      await Promise.all([stock.reload(), graces.reload()]);
      const wind = result.ok && result.data.fairWind;
      await props.onDone(
        result.ok
          ? {
              kind: 'status',
              text: [
                t(result.replayed ? 'departure.alreadySailed' : 'departure.sailed', {
                  ship: props.shipName,
                  city: house.cityNames[result.data.toCityId] ?? result.data.toCityId,
                  time: time.format(new Date(result.data.arrivesAt)),
                  cost: money(result.data.costOboles),
                }),
                ...(wind ? [saved(wind.savedSeconds, 'sailedWind')] : []),
              ].join(' '),
            }
          : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
    } finally {
      running.current = false;
      setBusy(false);
      props.onBusyChange?.(false);
    }
  }

  const heading = (
    <h3 ref={title} tabIndex={-1} className="text-base font-semibold">
      <Anchor aria-hidden="true" className="mr-2 inline size-5 align-[-0.15em] text-accent" />
      {t('departure.title')}
    </h3>
  );
  if (destinations.length === 0)
    return (
      <>
        {heading}
        <p>{t('departure.noDestination')}</p>
      </>
    );
  const destinationStep = (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="sr-only">{t('departure.destination')}</legend>
      {destinations.map(({ cityId, quote, longer, shorter, stormy, seconds }) => (
        <label key={cityId} className={cn(ROW, 'flex-nowrap items-start py-2.5')}>
          <input
            type="radio"
            className="mt-1 size-4 shrink-0 accent-primary"
            name="destination"
            value={cityId}
            checked={to === cityId}
            onChange={() => setTo(cityId)}
          />
          <span className="min-w-0">
            {t(`departure.option${longer ? 'Storm' : ''}${shorter ? 'Wind' : ''}`, {
              city: house.cityNames[cityId] ?? cityId,
              hours: hours(seconds),
              stormy: hours(stormy),
              calm: hours(quote.durationSeconds),
              cost: money(quote.totalOboles),
            })}
          </span>
        </label>
      ))}
    </fieldset>
  );
  const cargoStep = (
    <div className="flex flex-col gap-3">
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1 font-semibold">
          {t('departure.cargo', {
            loaded: number.format(loaded),
            capacity: number.format(capacity),
          })}
        </legend>
        {free.length === 0 && <p className="text-muted-foreground">{t('departure.noStock')}</p>}
        {free.map(({ goodId, free: available }) => (
          <label key={goodId} className={ROW}>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={available}
              step={1}
              className="min-h-9 w-24 max-w-full rounded-md border border-border bg-surface-raised px-2 tabular-nums"
              value={quantities[goodId] ?? ''}
              onChange={(event) =>
                setQuantities((before) => ({ ...before, [goodId]: event.target.value }))
              }
            />
            {t('departure.good', {
              good: t(`goods.${goodId}`, { defaultValue: goodId }),
              free: number.format(available),
            })}
          </label>
        ))}
      </fieldset>
      {loaded > capacity && (
        <p role="alert" className={WARNING}>
          {t('errors.CARGO_OVER_CAPACITY')}
        </p>
      )}
      {overStock && (
        <p role="alert" className={WARNING}>
          {t('departure.overStock')}
        </p>
      )}
    </div>
  );
  const recapStep = (
    <div className="flex flex-col gap-3">
      {chosen && (
        <p className="font-semibold">
          {t(cargo.length === 0 ? 'departure.summaryBallast' : 'departure.summary', {
            city: house.cityNames[chosen.cityId] ?? chosen.cityId,
            hours: hours(chosen.seconds),
            cargo: formatList(
              i18n.language,
              cargo.map(({ goodId, quantity }) =>
                t('home.stack', {
                  quantity: number.format(quantity),
                  good: t(`goods.${goodId}`, { defaultValue: goodId }),
                }),
              ),
            ),
          })}
        </p>
      )}
      {chosen?.storm && (
        <p>{describeWorldEvent(chosen.storm, t, i18n.language, house.cityNames)}</p>
      )}
      {chosen?.wind && (
        <p>{saved(chosen.stormy - chosen.seconds, 'fairWind', chosen.wind.godId)}</p>
      )}
      {chosen && (
        <p className="rounded-lg bg-aegean-subtle p-3">
          {t('departure.cost', {
            total: money(chosen.quote.totalOboles),
            provisions: money(chosen.quote.provisionsOboles),
            dues: money(chosen.quote.portDuesOboles),
          })}
        </p>
      )}
      {failure && (
        <p role="alert" className={WARNING}>
          {failure}
        </p>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      {heading}
      {/* Région toujours présente : la durée est provisoire tant que les tempêtes et les vents se lisent. */}
      <p role="status" className="empty:sr-only">
        {[
          storms.events === null && !storms.failed && t('departure.stormsLoading'),
          uses === null && !windsFailed && t('departure.windsLoading'),
        ]
          .filter(Boolean)
          .join(' ')}
      </p>
      {storms.failed && <p>{t('departure.stormsUnknown')}</p>}
      {windsFailed && <p>{t('departure.windsUnknown')}</p>}
      {(storms.failed || windsFailed) && (
        <LoadProblem
          heading={title}
          onRetry={() =>
            Promise.all([storms.failed && storms.reload(), windsFailed && graces.reload()])
          }
        />
      )}
      <Stepper
        steps={[
          {
            id: 'destination',
            title: t('departure.destination'),
            content: destinationStep,
            valid: !!chosen,
          },
          { id: 'cargo', title: t('departure.stepCargo'), content: cargoStep, valid: !blocked },
          {
            id: 'recap',
            title: t('departure.stepRecap'),
            content: recapStep,
            valid: !!chosen && !blocked && !!voyageCounts,
          },
        ]}
        onConfirm={() => void depart()}
        confirming={busy}
        labels={{
          progress: t('departure.steps'),
          back: t('departure.back'),
          next: t('departure.next'),
          confirm: chosen
            ? t('departure.submit', {
                city: house.cityNames[chosen.cityId] ?? chosen.cityId,
                cost: money(chosen.quote.totalOboles),
              })
            : t('departure.choose'),
          stepOf: (current, total) =>
            t('departure.stepOf', { current: number.format(current), total: number.format(total) }),
        }}
      />
    </div>
  );
}
