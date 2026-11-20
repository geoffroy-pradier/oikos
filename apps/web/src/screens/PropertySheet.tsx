import { DataTable, type DataTableProps } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import type { PropertyCommandInputs } from '../api';

/** Lance une commande de l'immobilier, sous la clé de son intention. */
export type RunCommand = <N extends keyof PropertyCommandInputs>(
  intent: string,
  name: N,
  input: PropertyCommandInputs[N],
) => Promise<void>;

/** Tableau de l'immobilier : `DataTable` à la langue de l'interface, tri annoncé comme aux comptes. */
export function PropertyTable<Row>(
  props: Omit<DataTableProps<Row>, 'sortAnnouncement' | 'locale'>,
) {
  const { t, i18n } = useTranslation();
  return (
    <DataTable
      {...props}
      locale={i18n.language}
      sortAnnouncement={(column, direction) =>
        t(direction === 'ascending' ? 'accounts.sortedAscending' : 'accounts.sortedDescending', {
          column,
        })
      }
    />
  );
}
