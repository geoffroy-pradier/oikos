import { Button, Field } from '@oikos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PropertyCommandInputs } from '../api';
import { useMoney } from '../money';
import type { MyProperty, Offer, PropertySize } from '../property';

type Command = keyof PropertyCommandInputs;
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

/**
 * Commandes du propriétaire sur un de ses biens (4.5) : rénovation au coût en vigueur, mise en vente ou
 * en location au prix saisi, retrait de l'offre ouverte. Un bien loué ne s'offre pas avant la fin du bail.
 */
export function PropertyActions({
  property,
  size,
  offer,
  leased,
  name,
  busy,
  run,
}: {
  property: MyProperty;
  size: PropertySize | undefined;
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
  const [typed, setTyped] = useState('');
  const value = Number(typed);
  const price = Number.isSafeInteger(value) && value > 0 ? value : null;
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
      {!offer && !leased && (
        <div className="flex flex-col gap-2">
          <Field
            label={t('property.priceLabel')}
            aria-label={`${t('property.priceLabel')} — ${name}`}
            error={typed !== '' && price === null ? t('property.priceInvalid') : undefined}
            inputMode="numeric"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {(['listForSale', 'offerLease'] as const).map((action) => (
              <Button
                key={action}
                variant="secondary"
                className={WAITING}
                aria-label={`${t(`property.${action}`)} — ${name}`}
                aria-disabled={busy || price === null}
                onClick={() => {
                  if (price === null) return;
                  const intent = `${action}:${property.id}:${price}`;
                  const propertyId = property.id;
                  void (action === 'listForSale'
                    ? run(intent, 'property.listForSale', { propertyId, priceOboles: price })
                    : run(intent, 'property.offerLease', { propertyId, rentOboles: price }));
                }}
              >
                {t(`property.${action}`)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
