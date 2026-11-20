import { Button, type DataColumn } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../money';
import type { Lease } from '../property';
import { PropertyTable, type RunCommand } from './PropertySheet';

export const endIntent = (leaseId: string) => `end:${leaseId}`;

/**
 * Baux de la maison (4.5), en tableau (fiches sur téléphone) : le bien, son rôle, le loyer d'un jour et
 * l'état du bail, avec « Mettre fin au bail » pour un bail en cours sans fin demandée.
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
            size="sm"
            variant="secondary"
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            aria-disabled={busy}
            aria-label={`${t('property.endLease')} — ${describe(lease)}`}
            onClick={() =>
              void run(endIntent(lease.id), 'property.endLease', { leaseId: lease.id })
            }
          >
            {t('property.endLease')}
          </Button>
        ),
    },
  ];
  return (
    <PropertyTable
      caption={t('property.leases')}
      columns={columns}
      rows={leases}
      rowKey={(lease) => lease.id}
    />
  );
}
