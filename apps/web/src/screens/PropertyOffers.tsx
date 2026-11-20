import { gameDayDate } from '@oikos/sim';
import { Badge, Button, CircleAlert, type DataColumn } from '@oikos/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useHouse } from '../house';
import { shortfall, useMoney } from '../money';
import { conditionShare, type Offer, type PropertySize } from '../property';
import { PropertySheet, PropertyTable, useSheet, type RunCommand } from './PropertySheet';

/** L'intention porte le prix vu : un autre prix est une autre demande, sous une clé neuve. */
export const offerIntent = (offer: Offer) =>
  `${offer.kind}:${offer.propertyId}:${offer.priceOboles}`;

/**
 * Biens offerts (4.5) : ceux de la cité et les offres des maisons, en tableau (fiches sur téléphone). Achat
 * et location s'ouvrent dans une feuille qui dit prix, état, entretien et, pour un bien à l'entretien
 * impayé, depuis quand ; la commande part au prix lu à l'ouverture de la feuille. Une offre de la maison
 * se dit « Votre offre », sans bouton. Un achat au-delà de la trésorerie a son bouton inactif, ce qui manque
 * dit dessous (#864) ; une location, dont rien n'est payé à la signature, reste proposée.
 */
export function PropertyOffers(props: {
  offers: Offer[];
  mineIds: ReadonlySet<string>;
  sizes: ReadonlyMap<string, PropertySize> | null;
  describe: (property: { sizeId: string; lot: number; cityId: string }) => string;
  /** Trésorerie de la maison ; `null` tant qu'elle n'est pas connue : l'API juge seule. */
  balance: number | null;
  busy: boolean;
  run: RunCommand;
}) {
  const { offers, mineIds, describe, busy, run } = props;
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const ids = useId();
  const missing = (offer: Offer) =>
    offer.kind === 'lease' ? null : shortfall(props.balance, offer.priceOboles);
  const { opened, open, refusal, outcome } = useSheet<Offer>();
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  // Un jour de jeu se lit à sa date civile, rendue à minuit UTC (`gameDayDate`).
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' });
  const price = (offer: Offer) =>
    t(offer.kind === 'lease' ? 'property.perDay' : 'property.once', {
      cost: money(offer.priceOboles),
    });
  const condition = (offer: Offer) =>
    offer.condition === null ? '—' : percent.format(conditionShare(offer.condition));
  const columns: DataColumn<Offer>[] = [
    {
      id: 'property',
      header: t('property.columns.property'),
      cell: (offer) => (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {describe(offer)}
          {offer.unpaid && (
            <Badge tone="danger" icon={<CircleAlert aria-hidden="true" />}>
              {t('property.unpaidBadge')}
            </Badge>
          )}
        </span>
      ),
      sortValue: describe,
    },
    {
      id: 'kind',
      header: t('property.columns.kind'),
      cell: (offer) => t(`property.kind.${offer.kind}`),
      sortValue: (offer) => t(`property.kind.${offer.kind}`),
    },
    {
      id: 'price',
      header: t('property.columns.price'),
      cell: price,
      sortValue: (offer) => offer.priceOboles,
      numeric: true,
    },
    {
      id: 'condition',
      header: t('property.columns.condition'),
      cell: condition,
      sortValue: (offer) => offer.condition,
      numeric: true,
    },
    {
      id: 'action',
      header: t('property.columns.action'),
      cell: (offer) =>
        mineIds.has(offer.propertyId) ? (
          <span className="text-muted-foreground">{t('property.yourOffer')}</span>
        ) : (
          <span className="flex flex-col items-start gap-1">
            <Button
              size="sm"
              variant="secondary"
              inactive={missing(offer) !== null}
              aria-describedby={
                missing(offer) === null ? undefined : `${ids}${offer.kind}${offer.propertyId}`
              }
              disabled={busy}
              aria-label={`${t(`property.take.${offer.kind}`, { cost: money(offer.priceOboles) })} — ${describe(offer)}`}
              onClick={() => open(offer)}
            >
              {t(`property.open.${offer.kind}`)}
            </Button>
            {missing(offer) !== null && (
              <span
                id={`${ids}${offer.kind}${offer.propertyId}`}
                className="text-xs text-muted-foreground"
              >
                {t('controls.shortfall', { missing: money(missing(offer) ?? 0) })}
              </span>
            )}
          </span>
        ),
    },
  ];

  const offer = opened;
  const size = offer && props.sizes?.get(offer.sizeId);
  const send = (offer: Offer) => {
    const { propertyId, priceOboles } = offer;
    const intent = offerIntent(offer);
    return offer.kind === 'lease'
      ? run(intent, 'property.lease', { propertyId, expectedRentOboles: priceOboles }, outcome)
      : run(
          intent,
          offer.kind === 'citySale' ? 'property.buy' : 'property.buyListed',
          { propertyId, expectedPriceOboles: priceOboles },
          outcome,
        );
  };
  return (
    <>
      <PropertyTable
        caption={t('property.offers')}
        columns={columns}
        rows={offers}
        rowKey={(row) => `${row.kind}:${row.propertyId}`}
      />
      <PropertySheet
        open={offer !== null}
        onClose={outcome.close}
        refusal={refusal}
        busy={busy}
        title={offer ? t(`property.sheet.${offer.kind}`, { name: describe(offer) }) : ''}
        facts={
          offer
            ? [
                [t(`property.columns.${offer.kind === 'lease' ? 'rent' : 'price'}`), price(offer)],
                [t('property.columns.condition'), condition(offer)],
                ...(offer.kind !== 'lease' && size
                  ? ([
                      [
                        t('property.columns.upkeep'),
                        t('property.perDay', { cost: money(size.dailyUpkeepOboles) }),
                      ],
                    ] as const)
                  : []),
                [t('property.columns.city'), house.cityNames[offer.cityId] ?? offer.cityId],
              ]
            : []
        }
        warning={
          offer?.unpaid
            ? offer.unpaid.day === null
              ? t('property.offerUnpaidUndated')
              : t('property.offerUnpaid', { date: day.format(gameDayDate(offer.unpaid.day)) })
            : null
        }
        {...(offer && {
          confirm: t(`property.confirm.${offer.kind}`, { cost: price(offer) }),
          onConfirm: () => void send(offer),
        })}
      />
    </>
  );
}
