import { Ban, Button, type DataColumn } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../money';
import type { Lease } from '../property';
import { PropertySheet, PropertyTable, useSheet, type RunCommand } from './PropertySheet';

export const endIntent = (leaseId: string) => `end:${leaseId}`;

/**
 * Baux de la maison (4.5), en tableau (fiches sur téléphone) : le bien, son rôle, le loyer d'un jour et
 * l'état du bail. Un bail en cours sans fin demandée se finit depuis une feuille qui rappelle le loyer et
 * que la fin demandée est définitive.
 */
export function PropertyLeases(props: {
  leases: Lease[];
  describe: (property: { sizeId: string; lot: number; cityId: string }) => string;
  busy: boolean;
  run: RunCommand;
}) {
  const { leases, describe, busy, run } = props;
  const { t } = useTranslation();
  const money = useMoney();
  const { opened: ending, open, refusal, outcome } = useSheet<Lease>();
  const role = (lease: Lease) => t(lease.asTenant ? 'property.tenant' : 'property.landlord');
  const rent = (lease: Lease) => t('property.perDay', { cost: money(lease.rentOboles) });
  const columns: DataColumn<Lease>[] = [
    { id: 'property', header: t('property.columns.property'), cell: describe, sortValue: describe },
    { id: 'role', header: t('property.columns.role'), cell: role, sortValue: role },
    {
      id: 'rent',
      header: t('property.columns.rent'),
      cell: rent,
      sortValue: (lease) => lease.rentOboles,
      numeric: true,
    },
    {
      id: 'status',
      header: t('property.columns.status'),
      cell: (lease) =>
        lease.endReason ? (
          t(`property.ended.${lease.endReason}`)
        ) : lease.ending ? (
          t('property.ending')
        ) : (
          <Button
            icon={<Ban aria-hidden="true" />}
            size="sm"
            variant="secondary"
            disabled={busy}
            aria-label={`${t('property.endLease')} — ${describe(lease)}`}
            onClick={() => open(lease)}
          >
            {t('property.endLease')}
          </Button>
        ),
    },
  ];
  return (
    <>
      <PropertyTable
        caption={t('property.leases')}
        columns={columns}
        rows={leases}
        rowKey={(lease) => lease.id}
      />
      <PropertySheet
        open={ending !== null}
        onClose={outcome.close}
        busy={busy}
        title={ending ? t('property.sheet.endLease', { name: describe(ending) }) : ''}
        facts={
          ending
            ? [
                [t('property.columns.role'), role(ending)],
                [t('property.columns.rent'), rent(ending)],
              ]
            : []
        }
        note={t('property.endNote')}
        confirm={t('property.confirm.endLease')}
        refusal={refusal}
        onConfirm={() =>
          ending &&
          void run(endIntent(ending.id), 'property.endLease', { leaseId: ending.id }, outcome)
        }
      />
    </>
  );
}
