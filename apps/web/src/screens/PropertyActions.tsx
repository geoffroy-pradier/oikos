import { PROPERTY_CONDITION_MAX, type MarketTaxRule } from '@oikos/sim';
import { Button, Field } from '@oikos/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PropertyCommandInputs } from '../api';
import { previewSale } from '../market-rules';
import { useMoney } from '../money';
import { conditionShare, type MyProperty, type Offer, type PropertySize } from '../property';

type Command = keyof PropertyCommandInputs;
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
/** Montant saisi en chiffres seulement (`Number` accepterait « 1e3 »), entier sûr et positif. */
const oboles = (typed: string) => {
  const value = /^\d+$/.test(typed.trim()) ? Number(typed.trim()) : 0;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

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
  const [salePrice, setSalePrice] = useState('');
  const [rent, setRent] = useState('');
  // Rénovation ou retrait choisi : récapitulé, puis confirmé.
  const [confirming, setConfirming] = useState<'renovate' | 'withdraw' | null>(null);
  const saleId = useId();
  const preview = previewSale(tax, 'sell', salePrice, '1');
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
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
            {t('property.backToActions')}
          </Button>
          <Button className="ml-auto" loading={busy} onClick={() => void recap.send()}>
            {recap.confirm}
          </Button>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      {renovation && (
        <Button
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
        (['listForSale', 'offerLease'] as const).map((action) => {
          const sale = action === 'listForSale';
          const [typed, setTyped] = sale ? [salePrice, setSalePrice] : [rent, setRent];
          const price = oboles(typed);
          const label = t(sale ? 'property.salePriceLabel' : 'property.rentLabel');
          return (
            <div key={action} className="flex flex-col gap-2">
              <Field
                id={sale ? saleId : undefined}
                label={label}
                aria-label={`${label} — ${name}`}
                hint={sale ? (net ?? undefined) : undefined}
                error={typed !== '' && price === null ? t('property.priceInvalid') : undefined}
                inputMode="numeric"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
              <Button
                variant="secondary"
                className={WAITING}
                aria-label={`${t(`property.${action}`)} — ${name}`}
                aria-describedby={sale && net ? `${saleId}-hint` : undefined}
                aria-disabled={busy || price === null}
                onClick={() => {
                  if (price === null) return;
                  const intent = `${action}:${property.id}:${price}`;
                  const propertyId = property.id;
                  void (sale
                    ? run(intent, 'property.listForSale', { propertyId, priceOboles: price })
                    : run(intent, 'property.offerLease', { propertyId, rentOboles: price }));
                }}
              >
                {t(`property.${action}`)}
              </Button>
            </div>
          );
        })}
    </div>
  );
}
