import type { MarketTaxRule } from '@oikos/sim';
import { Badge, Button, CircleAlert, Sheet, type DataColumn } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../money';
import { conditionShare, type MyProperty, type Offer, type PropertySize } from '../property';
import { PropertyActions } from './PropertyActions';
import { PropertyTable, SheetAlert, useSheet, type RunCommand } from './PropertySheet';

/**
 * Biens de la maison (4.5), en tableau (fiches sur téléphone) : état, entretien d'un jour, situation (loué,
 * offert, entretien impayé). « Gérer » ouvre la fiche du bien dans une feuille, avec ses commandes ; une
 * commande aboutie la ferme et s'annonce sous le titre de la liste, un refus se dit dans la fiche.
 */
export function MyProperties(props: {
  properties: MyProperty[];
  sizes: ReadonlyMap<string, PropertySize> | null;
  /** Taxe de marché de la cité d'un bien ; `null` tant qu'elle n'est pas lue. */
  taxIn: (cityId: string) => MarketTaxRule | null;
  offerOf: (propertyId: string) => Offer | undefined;
  /** Loyer du bail en cours d'un bien loué à une autre maison. */
  rentOf: (propertyId: string) => number | undefined;
  describe: (property: { sizeId: string; lot: number; cityId: string }) => string;
  busy: boolean;
  run: RunCommand;
}) {
  const { properties, describe, busy, run } = props;
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const { opened: openId, open, refusal, outcome } = useSheet<string>();
  const condition = (property: MyProperty) => percent.format(conditionShare(property.condition));
  const upkeep = (property: MyProperty) => {
    const size = props.sizes?.get(property.sizeId);
    return size ? t('property.perDay', { cost: money(size.dailyUpkeepOboles) }) : '—';
  };
  const situation = (property: MyProperty) => {
    const rent = props.rentOf(property.id);
    const offer = props.offerOf(property.id);
    const said = [
      rent !== undefined && t('property.leasedOut', { cost: money(rent) }),
      offer &&
        t(`property.listed.${offer.kind === 'lease' ? 'lease' : 'sale'}`, {
          cost: money(offer.priceOboles),
        }),
    ].filter(Boolean);
    return said.length > 0 ? said.join(' · ') : t('property.free');
  };
  const unpaid = (property: MyProperty) =>
    property.unpaidSince &&
    t('property.unpaidSince', { date: date.format(new Date(property.unpaidSince)) });
  const columns: DataColumn<MyProperty>[] = [
    {
      id: 'property',
      header: t('property.columns.property'),
      cell: (property) => (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {describe(property)}
          {property.unpaidSince && (
            <Badge tone="danger" icon={<CircleAlert aria-hidden="true" />}>
              {unpaid(property)}
            </Badge>
          )}
        </span>
      ),
      sortValue: describe,
    },
    {
      id: 'condition',
      header: t('property.columns.condition'),
      cell: condition,
      sortValue: (property) => property.condition,
      numeric: true,
    },
    { id: 'upkeep', header: t('property.columns.upkeep'), cell: upkeep, numeric: true },
    { id: 'situation', header: t('property.columns.situation'), cell: situation },
    {
      id: 'action',
      action: true,
      header: t('property.columns.action'),
      cell: (property) => (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          aria-label={`${t('property.manage')} — ${describe(property)}`}
          onClick={() => open(property.id)}
        >
          {t('property.manage')}
        </Button>
      ),
    },
  ];
  // La fiche suit la dernière lecture du bien ; un bien disparu (vendu) la ferme.
  const property = properties.find((candidate) => candidate.id === openId);
  return (
    <>
      <PropertyTable
        caption={t('property.mine')}
        columns={columns}
        rows={properties}
        rowKey={(row) => row.id}
      />
      <Sheet
        open={property !== undefined}
        onClose={() => !busy && outcome.close()}
        title={property ? describe(property) : ''}
        closeLabel={t('shell.close')}
        closeDisabled={busy}
      >
        {property && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-2.5">
              {[
                [t('property.columns.condition'), condition(property)],
                [t('property.columns.upkeep'), upkeep(property)],
                [t('property.columns.situation'), situation(property)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-surface-raised p-3 last:col-span-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-bold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {property.unpaidSince && (
              <p className="flex items-start gap-2 rounded-lg bg-danger-subtle p-3 text-sm font-medium text-danger">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {t('property.unpaidNote')}
              </p>
            )}
            <PropertyActions
              property={property}
              size={props.sizes?.get(property.sizeId)}
              tax={props.taxIn(property.cityId)}
              offer={props.offerOf(property.id)}
              leased={props.rentOf(property.id) !== undefined}
              name={describe(property)}
              busy={busy}
              run={(intent, name, input) => run(intent, name, input, outcome)}
            />
            <SheetAlert refusal={refusal} />
          </div>
        )}
      </Sheet>
    </>
  );
}
