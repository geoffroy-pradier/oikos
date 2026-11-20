import { useState, type ReactNode } from 'react';
import { cn } from '../cn';

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
  const [first, ...details] = columns;
  const align = (column: DataColumn<Row>) => (column.numeric ? 'text-right tabular-nums' : '');

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
          </li>
        ))}
      </ul>
      {/* Absente sous 1 024 px, où rien ne se trie. */}
      <p role="status" className="sr-only max-lg:hidden">
        {announced && sortColumn && sort && sortAnnouncement(sortColumn.header, sort.direction)}
      </p>
      <table className="hidden w-full border-collapse text-sm lg:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border-subtle text-xs text-muted-foreground">
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
                  className={cn('px-3 py-2 font-medium', align(column) || 'text-left')}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center gap-1 rounded-md hover:text-foreground"
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
                    className={cn('px-3 py-2.5 text-left font-normal', align(column))}
                  >
                    {column.cell(row)}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
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
