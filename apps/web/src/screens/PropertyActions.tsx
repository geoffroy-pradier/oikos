import { PROPERTY_CONDITION_MAX, type MarketTaxRule } from '@oikos/sim';
import { ArrowLeft, Button, Check, Hammer, NumberField, Stepper, Tag, Undo2 } from '@oikos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PropertyCommandInputs } from '../api';
import { previewSale } from '../market-rules';
import { useMoney } from '../money';
import { conditionShare, type MyProperty, type Offer, type PropertySize } from '../property';

type Command = keyof PropertyCommandInputs;
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
/** Prix saisi : un entier sûr et positif d'oboles, sinon rien ne part. */
const valid = (price: number | null): price is number =>
  price !== null && Number.isSafeInteger(price) && price > 0;

/** Contrôles proposés pour un bien de la maison : le rendu et les intentions offertes en dépendent. */
function controls(
  property: MyProperty,
  size: PropertySize | undefined,
  offer?: Offer,
  leased = false,
) {
  const renovation = size?.renovation;
  return {
    renovation: renovation && property.condition < PROPERTY_CONDITION_MAX ? renovation : undefined,
    withdraw: offer !== undefined,
    list: !offer && !leased,
  };
}
// L'état lu entre dans l'intention : après une rénovation aboutie sans réponse, l'usure du jour ne fait pas
// reprendre l'ancienne clé, qui rejouerait l'ancienne réponse sans rien rénover.
const renovateIntent = (
  propertyId: string,
  condition: number,
  renovation: PropertySize['renovation'],
) => `renovate:${propertyId}:${condition}:${JSON.stringify(renovation)}`;

/**
 * Intentions que proposent les contrôles d'un bien de la maison ; une intention finie par `:` vaut pour
 * tout prix saisi. Voir `PropertyScreen` : une intention qui n'est plus proposée est rendue.
 */
export function ownerIntents(
  property: MyProperty,
  size: PropertySize | undefined,
  offer: Offer | undefined,
  leased: boolean,
): string[] {
  const shown = controls(property, size, offer, leased);
  return [
    ...(shown.renovation
      ? [renovateIntent(property.id, property.condition, shown.renovation)]
      : []),
    ...(shown.withdraw ? [`withdraw:${property.id}`] : []),
    ...(shown.list ? [`listForSale:${property.id}:`, `offerLease:${property.id}:`] : []),
  ];
}

/**
 * Commandes du propriétaire sur un de ses biens (4.5) : rénovation au coût en vigueur, mise en vente ou
 * en location au prix saisi, retrait de l'offre ouverte. Un bien loué ne s'offre pas avant la fin du bail.
 * Prix de vente et loyer par jour ont chacun leur saisie ; sous le prix de vente, le net du vendeur après
 * la taxe de marché de la cité du bien (5.3), calculé comme l'API la prélève, comme à l'agora.
 */
export function PropertyActions({
  property,
  size,
  tax,
  offer,
  leased,
  name,
  busy,
  run,
}: {
  property: MyProperty;
  size: PropertySize | undefined;
  /** Taxe de marché de la cité du bien ; `null` tant qu'elle n'est pas lue : aucun net annoncé. */
  tax: MarketTaxRule | null;
  offer: Offer | undefined;
  leased: boolean;
  /** Nom du bien (taille, lot, cité) : chaque contrôle répété par bien le porte pour un lecteur d'écran. */
  name: string;
  busy: boolean;
  run: <N extends Command>(
    intent: string,
    name: N,
    input: PropertyCommandInputs[N],
  ) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const number = new Intl.NumberFormat(i18n.language);
  const goodName = (id: string) => t(`goods.${id}`, { defaultValue: id });
  // Commande choisie : rénovation ou retrait récapitulés, puis confirmés ; mise en vente ou en
  // location par étapes, le prix saisi puis récapitulé.
  const [confirming, setConfirming] = useState<
    'renovate' | 'withdraw' | 'listForSale' | 'offerLease' | null
  >(null);
  const [price, setPrice] = useState<number | null>(null);
  const sale = confirming === 'listForSale';
  const preview = sale ? previewSale(tax, 'sell', String(price ?? ''), '1') : null;
  const net =
    preview &&
    t('property.expectedNet', {
      net: money(preview.net),
      gross: money(preview.gross),
      tax: money(preview.tax),
    });
  const shown = controls(property, size, offer, leased);
  const renovation = shown.renovation;
  const renovationCost =
    renovation &&
    [
      money(renovation.oboles),
      ...renovation.goods.map((stack) =>
        t('property.goodLine', {
          quantity: number.format(stack.quantity),
          good: goodName(stack.goodId),
        }),
      ),
    ].join(', ');
  const renovateText = renovationCost && t('property.renovate', { cost: renovationCost });
  const withdrawText =
    offer && t(`property.withdraw.${offer.kind}`, { cost: money(offer.priceOboles) });
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent' });
  const recap =
    confirming === 'renovate' && renovation
      ? {
          facts: [
            [t('property.columns.cost'), renovationCost ?? ''],
            [
              t('property.columns.condition'),
              `${percent.format(conditionShare(property.condition))} → ${percent.format(1)}`,
            ],
          ],
          confirm: t('property.confirm.renovate'),
          send: () =>
            run(renovateIntent(property.id, property.condition, renovation), 'property.renovate', {
              propertyId: property.id,
              expectedCostOboles: renovation.oboles,
              expectedGoods: renovation.goods,
            }),
        }
      : confirming === 'withdraw' && withdrawText
        ? {
            facts: [[t('property.columns.offer'), withdrawText]],
            confirm: t('property.confirm.withdraw'),
            send: () =>
              run(`withdraw:${property.id}`, 'property.withdrawOffer', {
                propertyId: property.id,
              }),
          }
        : null;
  if (recap)
    return (
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-2.5">
          {recap.facts.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-surface-raised p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<ArrowLeft aria-hidden="true" />}
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setConfirming(null)}
          >
            {t('property.backToActions')}
          </Button>
          <Button
            icon={<Check aria-hidden="true" />}
            className="ml-auto"
            loading={busy}
            onClick={() => void recap.send()}
          >
            {recap.confirm}
          </Button>
        </div>
      </div>
    );
  const back = (
    <Button
      icon={<ArrowLeft aria-hidden="true" />}
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => setConfirming(null)}
    >
      {t('property.backToActions')}
    </Button>
  );
  if (shown.list && (confirming === 'listForSale' || confirming === 'offerLease')) {
    const label = t(sale ? 'property.salePriceLabel' : 'property.rentLabel');
    const asked = !valid(price)
      ? ''
      : sale
        ? money(price)
        : t('property.perDay', { cost: money(price) });
    const facts = [
      [t(sale ? 'property.columns.price' : 'property.columns.rent'), asked],
      ...(preview ? [[t('property.columns.net'), money(preview.net)]] : []),
    ];
    return (
      <div className="flex flex-col gap-3">
        <div>{back}</div>
        <Stepper
          steps={[
            {
              id: 'price',
              title: t('property.steps.price'),
              valid: valid(price),
              content: (
                <NumberField
                  label={label}
                  aria-label={`${label} — ${name}`}
                  locale={i18n.language}
                  min={1}
                  value={price}
                  onValueChange={setPrice}
                  hint={net ?? undefined}
                  labels={{
                    decrement: t('controls.decrement'),
                    increment: t('controls.increment'),
                    all: t('controls.all'),
                    shortcuts: t('controls.shortcuts'),
                  }}
                  messages={Object.fromEntries(
                    (['unreadable', 'ambiguous', 'notInteger', 'belowMin'] as const).map(
                      (problem) => [problem, t('property.priceInvalid')],
                    ),
                  )}
                />
              ),
            },
            {
              id: 'recap',
              title: t('property.steps.recap'),
              content: (
                <div className="flex flex-col gap-2.5">
                  <dl className="grid grid-cols-2 gap-2.5">
                    {facts.map(([fact, value]) => (
                      <div key={fact} className="rounded-xl bg-surface-raised p-3">
                        <dt className="text-xs text-muted-foreground">{fact}</dt>
                        <dd className="mt-1 font-bold tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {net && <p className="text-sm text-muted-foreground">{net}</p>}
                </div>
              ),
            },
          ]}
          confirming={busy}
          onConfirm={() => {
            if (!valid(price)) return;
            const intent = `${confirming}:${property.id}:${price}`;
            const propertyId = property.id;
            void (sale
              ? run(intent, 'property.listForSale', { propertyId, priceOboles: price })
              : run(intent, 'property.offerLease', { propertyId, rentOboles: price }));
          }}
          labels={{
            progress: t('stepper.progress'),
            back: t('stepper.back'),
            next: t('stepper.next'),
            confirm: t(`property.confirm.${confirming}`, { cost: asked }),
            stepOf: (current, total) =>
              t('stepper.stepOf', { current: number.format(current), total: number.format(total) }),
          }}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {renovation && (
        <Button
          icon={<Hammer aria-hidden="true" />}
          variant="secondary"
          className={WAITING}
          aria-disabled={busy}
          aria-label={`${renovateText} — ${name}`}
          onClick={() => setConfirming('renovate')}
        >
          {renovateText}
        </Button>
      )}
      {offer && (
        <Button
          icon={<Undo2 aria-hidden="true" />}
          variant="secondary"
          className={WAITING}
          aria-disabled={busy}
          aria-label={`${withdrawText} — ${name}`}
          onClick={() => setConfirming('withdraw')}
        >
          {withdrawText}
        </Button>
      )}
      {shown.list &&
        (['listForSale', 'offerLease'] as const).map((action) => (
          <Button
            icon={<Tag aria-hidden="true" />}
            key={action}
            variant="secondary"
            className={WAITING}
            aria-disabled={busy}
            aria-label={`${t(`property.${action}`)} — ${name}`}
            onClick={() => {
              setPrice(null);
              setConfirming(action);
            }}
          >
            {t(`property.${action}`)}
          </Button>
        ))}
      {leased && !offer && (
        <p className="text-sm text-muted-foreground">{t('property.leasedNote')}</p>
      )}
    </div>
  );
}
