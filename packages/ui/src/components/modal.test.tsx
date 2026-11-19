// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Sheet } from './Sheet';

afterEach(cleanup);

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Vendre</Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Vendre du vin"
        closeLabel="Fermer"
        footer={<Button>Confirmer</Button>}
      >
        <input aria-label="Quantité" />
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  const open = () => {
    render(<SheetHarness />);
    const trigger = screen.getByRole('button', { name: 'Vendre' });
    trigger.focus();
    fireEvent.click(trigger);
    return { trigger, sheet: screen.getByRole('dialog', { name: 'Vendre du vin' }) };
  };

  it('est modale, prend le foyer et bloque le défilement de la page', () => {
    const { sheet } = open();
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fermer' }));
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('garde le foyer à la tabulation, dans les deux sens', () => {
    const { sheet } = open();
    const close = screen.getByRole('button', { name: 'Fermer' });
    const confirm = screen.getByRole('button', { name: 'Confirmer' });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it.each([
    ['Échap', () => fireEvent.keyDown(screen.getByLabelText('Quantité'), { key: 'Escape' })],
    ['Fermer', () => fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))],
  ])('se ferme par %s, rend le foyer au déclencheur et le défilement', (_name, close) => {
    const { trigger } = open();
    close();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.documentElement.style.overflow).toBe('');
  });
});

describe('Dialog', () => {
  it('pose une question nommée et décrite ; le premier bouton prend le foyer ; Échap annule', () => {
    let cancelled = 0;
    render(
      <Dialog
        open
        onClose={() => (cancelled += 1)}
        title="Démolir l’atelier ?"
        description="Les stocks restent dans l’entrepôt."
        actions={
          <>
            <Button variant="secondary">Annuler</Button>
            <Button variant="danger">Démolir</Button>
          </>
        }
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Démolir l’atelier ?' });
    expect(dialog.getAttribute('aria-describedby')).toBe(
      screen.getByText('Les stocks restent dans l’entrepôt.').id,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(cancelled).toBe(1);
  });
});
