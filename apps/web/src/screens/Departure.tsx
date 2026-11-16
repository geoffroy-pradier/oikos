import { Button } from '@oikos/ui';
import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { departVoyage } from '../api';
import { useRows } from '../data';
import type { ShipRow } from '../fleet';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { countedIntent, countedIntentBelow, pendingKeys, sendUnderKey } from '../pending-keys';
import { destinationsFrom, quoteDeparture, type ShipRules } from '../ship-rules';

interface Inventory {
  city_id: string;
  good_id: string;
  quantity: number;
  reserved: number;
}
export type DepartureNotice = { kind: 'status' | 'alert'; text: string };

/**
 * Départ d'un navire à quai (4.6) : une destination, une cargaison prise dans le stock libre de la cité
 * (facultative : sans cargaison, le navire part sur lest), le coût annoncé avant l'envoi. Trois touches au
 * plus : la destination, puis « Partir ».
 */
export function Departure(props: {
  ship: ShipRow & { docked_city_id: string };
  shipName: string;
  rules: ShipRules;
  slugs: ReadonlyMap<string, string>;
  /** Voyages de la maison, par navire : le compte qui rend caduque la clé d'un départ abouti. */
  voyageCounts: ReadonlyMap<string, number> | null;
  onDone: (notice: DepartureNotice) => Promise<unknown>;
}) {
  const { ship, rules, slugs, voyageCounts } = props;
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const number = new Intl.NumberFormat(i18n.language);
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
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
  const destinations = destinationsFrom(rules, fromSlug).flatMap(({ slug }) => {
    const cityId = idOf.get(slug);
    const quote = cityId && quoteDeparture(rules, ship.class_id, fromSlug, slug);
    return cityId && quote ? [{ cityId, quote }] : [];
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
  useLayoutEffect(() => {
    if (!voyageCounts || running.current) return;
    pending.settleWhere(countedIntentBelow('depart', (shipId) => voyageCounts.get(shipId) ?? 0));
  }, [pending, voyageCounts]);

  async function depart(event: FormEvent) {
    event.preventDefault();
    const intent = countedIntent(
      'depart',
      ship.id,
      voyageCounts ? (voyageCounts.get(ship.id) ?? 0) : null,
    );
    if (!chosen || intent === null || blocked || running.current) return;
    running.current = true;
    setBusy(true);
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
      // Relu après toute issue : un refus (stock insuffisant) a pu venir d'un stock changé entre-temps.
      await stock.reload();
      await props.onDone(
        result.ok
          ? {
              kind: 'status',
              text: t(result.replayed ? 'departure.alreadySailed' : 'departure.sailed', {
                ship: props.shipName,
                city: house.cityNames[result.data.toCityId] ?? result.data.toCityId,
                time: time.format(new Date(result.data.arrivesAt)),
                cost: money(result.data.costOboles),
              }),
            }
          : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  if (destinations.length === 0) return <p>{t('departure.noDestination')}</p>;
  return (
    <form onSubmit={(event) => void depart(event)} className="flex flex-col gap-3">
      <fieldset>
        <legend className="font-semibold">{t('departure.destination')}</legend>
        {destinations.map(({ cityId, quote }) => (
          <label key={cityId} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="destination"
              value={cityId}
              checked={to === cityId}
              onChange={() => setTo(cityId)}
            />
            {t('departure.option', {
              city: house.cityNames[cityId] ?? cityId,
              hours: number.format(Math.round((quote.durationSeconds / 3600) * 10) / 10),
              cost: money(quote.totalOboles),
            })}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="font-semibold">
          {t('departure.cargo', {
            loaded: number.format(loaded),
            capacity: number.format(capacity),
          })}
        </legend>
        {free.length === 0 && <p className="text-muted-foreground">{t('departure.noStock')}</p>}
        {free.map(({ goodId, free: available }) => (
          <label key={goodId} className="flex min-h-11 items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={available}
              step={1}
              className="w-24 rounded border px-2 py-1"
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
      {loaded > capacity && <p role="alert">{t('errors.CARGO_OVER_CAPACITY')}</p>}
      {overStock && <p role="alert">{t('departure.overStock')}</p>}
      {chosen && (
        <p>
          {t('departure.cost', {
            total: money(chosen.quote.totalOboles),
            provisions: money(chosen.quote.provisionsOboles),
            dues: money(chosen.quote.portDuesOboles),
          })}
        </p>
      )}
      <Button type="submit" disabled={busy || !chosen || blocked || !voyageCounts}>
        {chosen
          ? t('departure.submit', {
              city: house.cityNames[chosen.cityId] ?? chosen.cityId,
              cost: money(chosen.quote.totalOboles),
            })
          : t('departure.choose')}
      </Button>
    </form>
  );
}
