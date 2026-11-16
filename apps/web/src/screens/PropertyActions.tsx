import type { MarketTaxRule } from '@oikos/sim';
import { Button, Field } from '@oikos/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PropertyCommandInputs } from '../api';
import { previewSale } from '../market-rules';
import { useMoney } from '../money';
import type { MyProperty, Offer, PropertySize } from '../property';

type Command = keyof PropertyCommandInputs;
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
/** Montant saisi en chiffres seulement (`Number` accepterait « 1e3 »), entier sûr et positif. */
const oboles = (typed: string) => {
  const value = /^\d+$/.test(typed.trim()) ? Number(typed.trim()) : 0;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

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
  const saleId = useId();
  const preview = previewSale(tax, 'sell', salePrice, '1');
  const net =
    preview &&
    t('property.expectedNet', {
      net: money(preview.net),
      gross: money(preview.gross),
      tax: money(preview.tax),
    });
  const renovation = size?.renovation;
  const renovateText =
    renovation &&
    t('property.renovate', {
      cost: [
        money(renovation.oboles),
        ...renovation.goods.map((stack) =>
          t('property.goodLine', {
            quantity: number.format(stack.quantity),
            good: goodName(stack.goodId),
          }),
        ),
      ].join(', '),
    });
  const withdrawText =
    offer && t(`property.withdraw.${offer.kind}`, { cost: money(offer.priceOboles) });
  return (
    <div className="flex flex-col gap-2">
      {renovation && property.condition < 10_000 && (
        <Button
          variant="secondary"
          className={WAITING}
          aria-disabled={busy}
          aria-label={`${renovateText} — ${name}`}
          onClick={() =>
            void run(`renovate:${property.id}:${JSON.stringify(renovation)}`, 'property.renovate', {
              propertyId: property.id,
              expectedCostOboles: renovation.oboles,
              expectedGoods: renovation.goods,
            })
          }
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
          onClick={() =>
            void run(`withdraw:${property.id}`, 'property.withdrawOffer', {
              propertyId: property.id,
            })
          }
        >
          {withdrawText}
        </Button>
      )}
      {!offer &&
        !leased &&
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
