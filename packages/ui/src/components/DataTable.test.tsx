// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable, type DataColumn } from './DataTable';

afterEach(cleanup);

describe('DataTable', () => {
  type Row = { good: string; value: number | null };
  const columns: DataColumn<Row>[] = [
    { id: 'good', header: 'Bien', cell: (row) => row.good, sortValue: (row) => row.good },
    {
      id: 'value',
      header: 'Valeur',
      numeric: true,
      cell: (row) => row.value ?? '—',
      sortValue: (row) => row.value,
    },
    { id: 'note', header: 'Note', cell: () => '' },
  ];
  const rows: Row[] = [
    { good: 'Vin', value: 20 },
    { good: 'Blé', value: null },
    { good: 'Huile', value: 50 },
  ];
  const table = () =>
    render(
      <DataTable
        caption="Stocks"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.good}
        defaultSort={{ column: 'value', direction: 'descending' }}
        sortAnnouncement={(header, direction) => `Trié par ${header}, ${direction}`}
        locale="fr"
      />,
    );
  const order = () =>
    within(screen.getByRole('table', { name: 'Stocks' }))
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent);

  it('trie au clavier par les boutons d’en-tête, avec aria-sort et une annonce', () => {
    table();
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    expect(order()).toEqual(['Huile', 'Vin', 'Blé']);
    const value = screen.getByRole('button', { name: /Valeur/ });
    expect(value.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    value.focus();
    fireEvent.click(value);
    // Les lignes sans valeur restent à la fin, dans les deux sens ; le foyer reste sur l'en-tête.
    expect(order()).toEqual(['Vin', 'Huile', 'Blé']);
    expect(value.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    expect(document.activeElement).toBe(value);
    expect(status.textContent).toBe('Trié par Valeur, ascending');
    fireEvent.click(screen.getByRole('button', { name: /Bien/ }));
    expect(order()).toEqual(['Blé', 'Huile', 'Vin']);
    expect(value.closest('th')?.hasAttribute('aria-sort')).toBe(false);
  });

  it('ne rend pas triable une colonne sans clé, et montre les mêmes lignes en fiches', () => {
    table();
    expect(screen.queryByRole('button', { name: 'Note' })).toBeNull();
    const cards = screen.getAllByRole('listitem');
    expect(cards.map((card) => card.querySelector('p')?.textContent)).toEqual(order());
    expect(within(cards[2] as HTMLElement).getByText('—')).toBeTruthy();
  });
  it('ordonne les textes selon la langue (accents, nombres) et garde l’ordre reçu des égalités', () => {
    const named: Row[] = [
      { good: 'Vin', value: 3 },
      { good: 'Écorce', value: 3 },
      { good: 'Lot 10', value: 1 },
      { good: 'Lot 9', value: 3 },
      { good: 'Argile', value: 1 },
    ];
    render(
      <DataTable
        caption="Stocks"
        columns={columns}
        rows={named}
        rowKey={(row) => row.good}
        sortAnnouncement={() => ''}
        locale="fr"
      />,
    );
    // Premier tri d'une colonne de texte : de A à Z, « Écorce » avec les E, « Lot 9 » avant « Lot 10 ».
    fireEvent.click(screen.getByRole('button', { name: /Bien/ }));
    expect(order()).toEqual(['Argile', 'Écorce', 'Lot 9', 'Lot 10', 'Vin']);
    // Premier tri d'une colonne de nombres : du plus grand au plus petit ; à valeur égale, l'ordre reçu.
    fireEvent.click(screen.getByRole('button', { name: /Valeur/ }));
    expect(order()).toEqual(['Vin', 'Écorce', 'Lot 9', 'Lot 10', 'Argile']);
  });

  it('une colonne d’action ferme la fiche sans ligne « Action », et reste un en-tête du tableau', () => {
    const withAction: DataColumn<Row>[] = [
      ...columns.slice(0, 2),
      {
        id: 'act',
        header: 'Action',
        action: true,
        cell: (row) => <button>{`Voir ${row.good}`}</button>,
      },
    ];
    const { container } = render(
      <DataTable
        caption="Stocks"
        columns={withAction}
        rows={rows}
        rowKey={(row) => row.good}
        sortAnnouncement={() => ''}
      />,
    );
    const cards = container.querySelector('ul') as HTMLElement;
    expect(within(cards).queryByText('Action')).toBeNull();
    const card = within(cards).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Voir Vin' })).toBeTruthy();
    expect(within(card).getByText('Valeur')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Stocks', hidden: true });
    expect(within(table).getByRole('columnheader', { name: 'Action', hidden: true })).toBeTruthy();
  });
});
