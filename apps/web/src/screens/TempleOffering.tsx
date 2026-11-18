import { templeMakeOfferingInputSchema } from '@oikos/contracts';
import { Button } from '@oikos/ui';
import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { makeOffering } from '../api';
import { useRows } from '../data';
import { useHouse } from '../house';
import { pendingKeys, sendUnderKey } from '../pending-keys';
import {
  acceptsOfferings,
  charisIntent,
  charisIntentStale,
  offeringQuote,
  type TempleRules,
} from '../temple';
import { useCommandNotice } from './CommandNotice';
import { LoadProblem } from './LoadProblem';

const OBOLES = ':oboles';
/** Borne des oboles d'une offrande, celle du contrat de la commande. */
const MAX_OBOLES = templeMakeOfferingInputSchema.shape.oboles.maxValue ?? Number.MAX_SAFE_INTEGER;
/** Saisie vide : rien ; sinon un entier positif ou nul écrit en chiffres, sans quoi la saisie est illisible. */
const amount = (text: string | undefined) =>
  !text?.trim() ? 0 : /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;

/**
 * Offrande à un dieu (7.1) : de la monnaie s'il l'accepte, et des biens qu'il accepte, pris dans le stock libre de
 * la maison dans sa cité, hors réservations des ventes. La Charis qu'elle rapporte est annoncée avant l'envoi et
 * envoyée telle quelle : un autre taux en vigueur est refusé, rien n'est offert. La même offrande restée sans
 * réponse repart sous la même clé, jusqu'à la relecture qui montre une autre Charis envers ce dieu (`charisIntent`) ;
 * une autre saisie est une autre demande.
 */
export function TempleOffering(props: {
  rules: TempleRules;
  /** Charis de la maison par dieu ; `null` tant qu'elle n'est pas lue : rien ne part. */
  favor: ReadonlyMap<string, number> | null;
  onDone: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const number = new Intl.NumberFormat(i18n.language);
  const gods = props.rules.gods.filter(acceptsOfferings);
  const [godId, setGodId] = useState('');
  const god = gods.find((candidate) => candidate.id === godId) ?? gods[0];
  // Saisies par bien, et celle des oboles sous une clé qu'aucun bien ne porte.
  const [values, setValues] = useState<Record<string, string>>({});
  const city = { city_id: house.cityId };
  type Line = { good_id: string; quantity: number; reserved: number };
  const stock = useRows<Line>('my_inventories', 'good_id, quantity, reserved', 'good_id', city);
  const free = (stock.rows ?? []).flatMap((line) => {
    const rate = god?.charisPerUnit[line.good_id] ?? 0;
    const available = line.quantity - line.reserved;
    return rate > 0 && available > 0 ? [{ goodId: line.good_id, available, rate }] : [];
  });
  const goodName = (id: string) => t(`goods.${id}`, { defaultValue: id });
  const godName = (id: string) => t(`gods.${id}`, { defaultValue: id });
  const money = !!god && god.charisPerObole > 0;
  const coins = money ? amount(values[OBOLES]) : 0;
  const goods = free.flatMap(({ goodId }) => {
    const quantity = amount(values[goodId]);
    return quantity === 0 ? [] : [{ goodId, quantity }];
  });
  const unreadable = Number.isNaN(coins) || goods.some(({ quantity }) => Number.isNaN(quantity));
  const tooMuch = coins > MAX_OBOLES;
  const overStock = goods.some(
    ({ goodId, quantity }) =>
      quantity > (free.find((line) => line.goodId === goodId)?.available ?? 0),
  );
  const quote =
    god && !unreadable && !overStock && !tooMuch
      ? offeringQuote(god, { oboles: coins, goods })
      : null;
  const rate = number.format(god?.charisPerObole ?? 0);
  const fields = [
    ...(money ? [{ key: OBOLES, label: t('temple.offering.oboles', { rate }) }] : []),
    ...free.map(({ goodId, available, rate }) => ({
      key: goodId,
      label: t('temple.offering.good', {
        good: goodName(goodId),
        free: number.format(available),
        rate: number.format(rate),
      }),
    })),
  ];

  const keys = useMemo(
    () => pendingKeys(`temple.${house.id}`, () => window.sessionStorage),
    [house.id],
  );
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const { setNotice, region } = useCommandNotice();
  // Une offrande faite sous une autre Charis que celle relue est lue (ou dépassée) : sa clé est rendue.
  const favorKey = JSON.stringify(props.favor && [...props.favor]);
  useLayoutEffect(() => {
    const favor = JSON.parse(favorKey) as [string, number][] | null;
    if (favor && !running.current) keys.settleWhere(charisIntentStale('offering', new Map(favor)));
  }, [keys, favorKey]);

  async function offer(event: FormEvent) {
    event.preventDefault();
    if (!god || quote === null || !props.favor || running.current) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    const input = { godId: god.id, oboles: coins, goods, expectedCharis: quote };
    const charis = props.favor.get(god.id) ?? 0;
    try {
      // Intention : la saisie entière et la Charis lue ; une autre saisie prend une clé neuve.
      const result = await sendUnderKey(
        keys,
        charisIntent('offering', god.id, charis, JSON.stringify(input)),
        () => crypto.randomUUID(),
        input,
        (key) => makeOffering(input, house.accessToken, key),
      );
      if (result.ok) setValues({});
      setNotice(
        result.ok
          ? {
              kind: 'status',
              text: t('temple.offering.done', {
                god: godName(result.data.godId),
                gained: number.format(result.data.charisGained),
                charis: number.format(result.data.charis),
              }),
            }
          : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
      await Promise.all([stock.reload(), props.onDone()]);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  if (!god) return <p className="text-muted-foreground">{t('temple.offering.noGod')}</p>;
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void offer(event)}>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t('temple.offering.god')}</span>
        <select
          className="min-h-11 rounded-md border border-border bg-surface px-3"
          value={god.id}
          onChange={(event) => {
            setGodId(event.target.value);
            setValues({});
          }}
        >
          {gods.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {godName(candidate.id)}
            </option>
          ))}
        </select>
      </label>
      {stock.failed && <LoadProblem onRetry={() => stock.reload()} />}
      {stock.rows !== null && Object.keys(god.charisPerUnit).length > 0 && free.length === 0 && (
        <p>{t('temple.offering.noStock', { god: godName(god.id) })}</p>
      )}
      {fields.map(({ key, label }) => (
        <label key={key} className="flex min-h-11 flex-wrap items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            className="w-28 rounded-md border border-border bg-surface px-2 py-1"
            value={values[key] ?? ''}
            onChange={(event) => setValues((before) => ({ ...before, [key]: event.target.value }))}
          />
          {label}
        </label>
      ))}
      {/* Régions présentes avant leur texte : la saisie fautive est dite, la Charis annoncée avant l'envoi. */}
      <p role="alert">
        {unreadable
          ? t('temple.offering.unreadable')
          : tooMuch
            ? t('temple.offering.tooMuch', { max: number.format(MAX_OBOLES) })
            : overStock
              ? t('temple.offering.overStock')
              : ''}
      </p>
      <p aria-live="polite">
        {quote === null
          ? t('temple.offering.empty')
          : t('temple.offering.quote', { charis: number.format(quote), god: godName(god.id) })}
      </p>
      <Button
        type="submit"
        className="self-start"
        disabled={busy || quote === null || !props.favor}
      >
        {t('temple.offering.submit', {
          god: godName(god.id),
          charis: number.format(quote ?? 0),
        })}
      </Button>
      {region}
    </form>
  );
}
