// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Sheet } from './Sheet';

afterEach(cleanup);

function SheetHarness({ autoFocus = false }: { autoFocus?: boolean }) {
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
        <input aria-label="Quantité" autoFocus={autoFocus} />
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  const open = (autoFocus = false) => {
    render(<SheetHarness autoFocus={autoFocus} />);
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
    // Ni bannière ni pied de page dans la feuille : ces repères restent ceux de la coquille (axe).
    expect(within(sheet).queryByRole('banner')).toBeNull();
    expect(within(sheet).queryByRole('contentinfo')).toBeNull();
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

  it('laisse le foyer à un enfant en autoFocus, et le rend pourtant au déclencheur', () => {
    const { trigger } = open(true);
    const input = screen.getByLabelText('Quantité');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Dialog', () => {
  function DialogHarness({ onCancel }: { onCancel: () => void }) {
    const [open, setOpen] = useState(false);
    const cancel = () => {
      onCancel();
      setOpen(false);
    };
    return (
      <>
        <Button onClick={() => setOpen(true)}>Démolir l’atelier</Button>
        <Dialog
          open={open}
          onClose={cancel}
          title="Démolir l’atelier ?"
          description="Les stocks restent dans l’entrepôt."
          actions={
            <>
              <Button variant="secondary" onClick={cancel}>
                Annuler
              </Button>
              <Button variant="danger">Démolir</Button>
            </>
          }
        />
      </>
    );
  }
  const open = (onCancel: () => void = () => undefined) => {
    render(<DialogHarness onCancel={onCancel} />);
    const trigger = screen.getByRole('button', { name: 'Démolir l’atelier' });
    trigger.focus();
    fireEvent.click(trigger);
    return { trigger, dialog: screen.getByRole('alertdialog', { name: 'Démolir l’atelier ?' }) };
  };

  it('pose une question nommée et décrite ; le premier bouton prend le foyer, qui reste piégé', () => {
    const { dialog } = open();
    expect(dialog.getAttribute('aria-describedby')).toBe(
      screen.getByText('Les stocks restent dans l’entrepôt.').id,
    );
    const cancel = screen.getByRole('button', { name: 'Annuler' });
    const confirm = screen.getByRole('button', { name: 'Démolir' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
  });

  it('ne se ferme pas au clic sur le voile ; Échap et Annuler annulent et rendent le foyer', () => {
    let cancelled = 0;
    const { trigger, dialog } = open(() => (cancelled += 1));
    fireEvent.click(dialog.previousElementSibling as HTMLElement);
    expect(screen.getByRole('alertdialog')).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(cancelled).toBe(2);
  });
});
