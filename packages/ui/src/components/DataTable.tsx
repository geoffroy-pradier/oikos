import { useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { TableScroll } from './TableScroll';

/**
 * Colonne d'action : large de quoi tenir un bouton qui ne passe jamais à la ligne et, dessous, une raison sur deux
 * lignes au plus (« Il manque … ») ; le reste de la largeur va aux autres colonnes.
 */
const ACTION = 'w-px min-w-56 text-left [&_button]:whitespace-nowrap';

export type SortDirection = 'ascending' | 'descending';

export interface DataColumn<Row> {
  id: string;
  /** En-tête, aussi libellé de la valeur dans les fiches et nom lu dans l'annonce du tri. */
  header: string;
  cell: (row: Row) => ReactNode;
  /** Clé de tri ; sans elle, la colonne ne se trie pas. `null` (sans valeur) va toujours à la fin. */
  sortValue?: (row: Row) => number | string | null;
  /** Montants et quantités : alignés à droite, en chiffres tabulaires. */
  numeric?: boolean;
  /**
   * Boutons de la ligne (« Acheter », « Gérer ») : sans libellé dans la fiche, où ils ferment la carte sous un
   * trait au lieu d'une ligne « Action » à moitié vide, et sans largeur à eux dans le tableau, alignés à droite.
   */
  action?: boolean;
}

export interface DataTableProps<Row> {
  /** Titre du tableau, lu par les lecteurs d'écran. */
  caption: string;
  /** La première colonne nomme la ligne (en-tête de ligne, titre de la fiche). */
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  defaultSort?: { column: string; direction: SortDirection };
  /** Phrase annoncée après un changement de tri (« Trié par Valeur, décroissant »). */
  sortAnnouncement: (header: string, direction: SortDirection) => string;
  /** Langue de comparaison des textes. */
  locale?: string;
  className?: string;
}

/**
 * Tableau dense et triable à partir de 1 024 px, fiches empilées en dessous, dans le même ordre. Le tri
 * se change au clavier par les boutons d'en-tête ; la colonne triée porte `aria-sort` et un triangle,
 * et chaque changement de tri est annoncé (`role="status"`).
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  defaultSort,
  sortAnnouncement,
  locale,
  className,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState(defaultSort);
  const [announced, setAnnounced] = useState(false);
  const sortColumn = columns.find((column) => column.id === sort?.column);
  const sorted = sortColumn?.sortValue ? sortRows(rows, sortColumn.sortValue, sort, locale) : rows;
  const [first, ...rest] = columns;
  const details = rest.filter((column) => !column.action);
  const actions = rest.filter((column) => column.action);
  const align = (column: DataColumn<Row>) =>
    column.numeric ? 'text-right tabular-nums' : column.action ? ACTION : '';

  return (
    <div className={className}>
      <ul className="flex flex-col gap-3 lg:hidden">
        {sorted.map((row) => (
          <li key={rowKey(row)} className="rounded-xl border border-border-subtle bg-surface p-4">
            <p className="font-semibold">{first?.cell(row)}</p>
            <dl className="mt-2 flex flex-col gap-1 text-sm">
              {details.map((column) => (
                <div key={column.id} className="flex flex-wrap justify-between gap-x-4">
                  <dt className="text-muted-foreground">{column.header}</dt>
                  <dd className={align(column)}>{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {actions.map((column) => (
              <div key={column.id} className="mt-3 border-t border-border-subtle pt-3">
                {column.cell(row)}
              </div>
            ))}
          </li>
        ))}
      </ul>
      {/* Absente sous 1 024 px, où rien ne se trie. */}
      <p role="status" className="sr-only max-lg:hidden">
        {announced && sortColumn && sort && sortAnnouncement(sortColumn.header, sort.direction)}
      </p>
      {/* Plus large que son cadre, le tableau défile et le dit par un fondu sur le bord (#865). */}
      <TableScroll label={caption} className="max-lg:hidden">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            {/* En-têtes sur deux lignes au plus, en casse normale : les libellés sont courts, l'alignement en bas. */}
            <tr className="border-b border-border-subtle align-bottom text-xs leading-tight text-muted-foreground">
              {columns.map((column) => {
                const active = sort?.column === column.id;
                const label = (
                  <>
                    {column.header}
                    {active && sort && (
                      <span aria-hidden="true">{sort.direction === 'descending' ? '▼' : '▲'}</span>
                    )}
                  </>
                );
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={active ? sort?.direction : undefined}
                    className={cn(
                      'px-1.5 py-2 font-medium',
                      column.action ? '' : 'min-w-20',
                      align(column) || 'text-left',
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        className={cn(
                          'inline-flex min-h-9 items-center gap-1 rounded-md hover:text-foreground',
                          column.numeric ? 'text-right' : 'text-left',
                        )}
                        // Même colonne : sens inverse. Autre colonne : textes de A à Z, nombres du plus grand au plus petit.
                        onClick={() => {
                          setSort({
                            column: column.id,
                            direction: active
                              ? sort?.direction === 'ascending'
                                ? 'descending'
                                : 'ascending'
                              : column.numeric
                                ? 'descending'
                                : 'ascending',
                          });
                          setAnnounced(true);
                        }}
                      >
                        {label}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border-subtle last:border-b-0">
                {columns.map((column, index) => {
                  const Cell = index === 0 ? 'th' : 'td';
                  return (
                    <Cell
                      key={column.id}
                      scope={index === 0 ? 'row' : undefined}
                      className={cn('px-1.5 py-2.5 text-left font-normal', align(column))}
                    >
                      {column.cell(row)}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

function sortRows<Row>(
  rows: readonly Row[],
  key: (row: Row) => number | string | null,
  sort: { direction: SortDirection } | undefined,
  locale: string | undefined,
): readonly Row[] {
  const collator = new Intl.Collator(locale, { numeric: true });
  const sign = sort?.direction === 'descending' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const order =
      typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(`${x}`, `${y}`);
    return sign * order;
  });
}
