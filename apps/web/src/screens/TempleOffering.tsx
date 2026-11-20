import { templeMakeOfferingInputSchema } from '@oikos/contracts';
import { NumberField, Select, Sheet, StatusRegion, Stepper } from '@oikos/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { makeOffering } from '../api';
import { useRows } from '../data';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { pendingKeys, sendUnderKey } from '../pending-keys';
import { useStepperLabels } from '../stepper-labels';
import {
  acceptsOfferings,
  charisIntent,
  charisIntentStale,
  offeringQuote,
  type TempleRules,
} from '../temple';
import { noticeClass, type Notice } from './CommandNotice';
import { LoadProblem } from './LoadProblem';

const OBOLES = ':oboles';
/** Borne des oboles d'une offrande, celle du contrat de la commande. */
const MAX_OBOLES = templeMakeOfferingInputSchema.shape.oboles.maxValue ?? Number.MAX_SAFE_INTEGER;
/** Saisie vide : rien ; sinon un entier positif ou nul, sans quoi la saisie est illisible. */
const amount = (typed: number | null | undefined) =>
  typed == null ? 0 : Number.isInteger(typed) && typed >= 0 ? typed : NaN;

/**
 * Offrande à un dieu (7.1) : de la monnaie s'il l'accepte, et des biens qu'il accepte, pris dans le stock libre de
 * la maison dans sa cité, hors réservations des ventes. La Charis qu'elle rapporte est annoncée avant l'envoi et
 * envoyée telle quelle : un autre taux en vigueur est refusé, rien n'est offert. La même offrande restée sans
 * réponse repart sous la même clé, jusqu'à la relecture qui montre une autre Charis envers ce dieu (`charisIntent`) ;
 * une autre saisie est une autre demande. En feuille (ADR 0011) : les dons, puis le récapitulatif au coût vu ;
 * faite, la feuille se ferme et le foyer passe sur le résultat, annoncé sous les cartes des dieux.
 */
export function TempleOffering(props: {
  rules: TempleRules;
  /** Charis de la maison par dieu ; `null` tant qu'elle n'est pas lue : rien ne part. */
  favor: ReadonlyMap<string, number> | null;
  onDone: () => Promise<unknown>;
  /** Dieu par lequel la feuille s'ouvre ; `null` : feuille fermée. */
  godId: string | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const drachmas = useMoney();
  const steps = useStepperLabels();
  const number = new Intl.NumberFormat(i18n.language);
  const gods = props.rules.gods.filter(acceptsOfferings);
  const [godId, setGodId] = useState('');
  const god = gods.find((candidate) => candidate.id === godId) ?? gods[0];
  // Saisies par bien, et celle des oboles sous une clé qu'aucun bien ne porte ; gardées à la fermeture.
  const [values, setValues] = useState<Record<string, number | null>>({});
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
    ...(money
      ? [{ key: OBOLES, label: t('temple.offering.oboles', { rate }), max: undefined }]
      : []),
    ...free.map(({ goodId, available, rate }) => ({
      key: goodId,
      max: available,
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
  const [notice, setNotice] = useState<Notice>(null);
  const done = useRef<HTMLParagraphElement>(null);
  // La feuille fermée, son bouton a disparu : le foyer passe sur le résultat.
  useEffect(() => {
    if (notice?.kind === 'status') done.current?.focus();
  }, [notice]);
  // Ouverte depuis la carte d'un dieu : ce dieu (la saisie d'un autre ne se reprend pas), et le stock libre relu.
  const live = useRef({ godId, reload: stock.reload });
  live.current = { godId, reload: stock.reload };
  useEffect(() => {
    if (props.godId === null) return;
    if (props.godId !== live.current.godId) setValues({});
    setGodId(props.godId);
    void live.current.reload();
  }, [props.godId]);
  const charis = (god && props.favor?.get(god.id)) ?? 0;
  // Une offrande faite sous une autre Charis que celle relue est lue (ou dépassée) : sa clé est rendue.
  const favorKey = JSON.stringify(props.favor && [...props.favor]);
  useLayoutEffect(() => {
    const favor = JSON.parse(favorKey) as [string, number][] | null;
    if (favor && !running.current) keys.settleWhere(charisIntentStale('offering', new Map(favor)));
  }, [keys, favorKey]);

  async function offer() {
    if (!god || quote === null || !props.favor || running.current) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    const input = { godId: god.id, oboles: coins, goods, expectedCharis: quote };
    try {
      // Intention : la saisie entière et la Charis lue ; une autre saisie prend une clé neuve.
      const result = await sendUnderKey(
        keys,
        charisIntent('offering', god.id, charis, JSON.stringify(input)),
        () => crypto.randomUUID(),
        input,
        (key) => makeOffering(input, house.accessToken, key),
      );
      if (result.ok) {
        setValues({});
        props.onClose();
      }
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

  const close = () => {
    // Commande en vol : la feuille reste ouverte, pour que son issue y soit dite.
    if (busy) return;
    setNotice(null);
    props.onClose();
  };
  const labels = {
    decrement: t('controls.decrement'),
    increment: t('controls.increment'),
    all: t('controls.all'),
    shortcuts: t('controls.shortcuts'),
  };
  const giftsStep = god && (
    <div className="flex flex-col gap-4">
      <Select
        label={t('temple.offering.god')}
        quiet
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
      </Select>
      {stock.failed && <LoadProblem onRetry={() => stock.reload()} />}
      {stock.rows !== null && Object.keys(god.charisPerUnit).length > 0 && free.length === 0 && (
        <p className="rounded-lg bg-muted p-3 text-sm">
          {t('temple.offering.noStock', { god: godName(god.id) })}
        </p>
      )}
      {fields.map(({ key, label, max }) => (
        <NumberField
          key={`${god.id}:${key}`}
          label={label}
          locale={i18n.language}
          min={0}
          {...(max === undefined ? { shortcuts: false } : { max })}
          labels={labels}
          value={values[key] ?? null}
          onValueChange={(value) => {
            setValues((before) => ({ ...before, [key]: value }));
            setNotice(null);
          }}
        />
      ))}
      {/* Régions présentes avant leur texte : la saisie fautive est dite, la Charis annoncée avant l'envoi. */}
      <StatusRegion role="alert" tone="danger">
        {unreadable
          ? t('temple.offering.unreadable')
          : tooMuch
            ? t('temple.offering.tooMuch', { max: number.format(MAX_OBOLES) })
            : overStock && t('temple.offering.overStock')}
      </StatusRegion>
      <p aria-live="polite" className="rounded-lg bg-accent-subtle px-3 py-2 text-sm font-medium">
        {quote === null
          ? t('temple.offering.empty')
          : t('temple.offering.quote', { charis: number.format(quote), god: godName(god.id) })}
      </p>
    </div>
  );
  const line = (term: string, value: string, strong = false) => (
    <div
      key={term}
      className={`flex flex-wrap justify-between gap-x-4 py-2 ${strong ? 'font-semibold' : ''}`}
    >
      <dt className={strong ? '' : 'text-muted-foreground'}>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
  // Récapitulatif au coût vu : la monnaie (en drachmes et oboles) et les biens donnés, la Charis gagnée.
  const recapStep = god && quote !== null && (
    <div className="flex flex-col gap-3">
      <p className="font-medium">{t('temple.offering.recap', { god: godName(god.id) })}</p>
      <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle px-3 tabular-nums">
        {coins > 0 && line(t('temple.offering.recapMoney'), drachmas(coins))}
        {goods.map(({ goodId, quantity }) => line(goodName(goodId), number.format(quantity)))}
        {line(t('temple.offering.recapGain'), `+${number.format(quote)}`, true)}
        {line(
          t('temple.offering.recapAfter', { god: godName(god.id) }),
          number.format(charis + quote),
        )}
      </dl>
      <p className="text-sm text-muted-foreground">{t('temple.offering.recapNote')}</p>
      <StatusRegion role="alert" tone="danger">
        {notice?.kind === 'alert' && notice.text}
      </StatusRegion>
    </div>
  );

  return (
    <>
      {/* Région présente avant son texte : l'offrande faite s'annonce sous les cartes des dieux. */}
      <p ref={done} role="status" tabIndex={-1} className={noticeClass('status')}>
        {notice?.kind === 'status' ? notice.text : ''}
      </p>
      <Sheet
        open={props.godId !== null}
        onClose={close}
        title={t('temple.offering.title')}
        description={t('temple.title', { city: house.cityName })}
        closeLabel={t('shell.close')}
        closeDisabled={busy}
      >
        {god ? (
          <Stepper
            confirming={busy}
            onConfirm={() => void offer()}
            labels={{
              ...steps,
              confirm: t('temple.offering.submit', {
                god: godName(god.id),
                charis: number.format(quote ?? 0),
              }),
            }}
            steps={[
              {
                id: 'gifts',
                title: t('temple.offering.stepGifts'),
                content: giftsStep,
                valid: quote !== null && props.favor !== null,
              },
              { id: 'recap', title: t('temple.offering.stepRecap'), content: recapStep },
            ]}
          />
        ) : (
          <p className="text-muted-foreground">{t('temple.offering.noGod')}</p>
        )}
      </Sheet>
    </>
  );
}
