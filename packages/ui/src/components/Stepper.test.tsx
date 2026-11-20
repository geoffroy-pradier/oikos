// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Stepper } from './Stepper';

afterEach(cleanup);

const labels = {
  progress: 'Étapes',
  back: 'Retour',
  next: 'Continuer',
  confirm: 'Confirmer',
  stepOf: (current: number, total: number) => `Étape ${current} sur ${total}`,
};

function Harness({ onConfirm }: { onConfirm: () => void }) {
  const [quantity, setQuantity] = useState('');
  return (
    <Stepper
      labels={labels}
      onConfirm={onConfirm}
      steps={[
        {
          id: 'quantity',
          title: 'Quantité',
          valid: Number(quantity) > 0,
          content: (
            <input
              aria-label="Amphores"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          ),
        },
        { id: 'note', title: 'Note', content: <input aria-label="Note" /> },
        { id: 'summary', title: 'Récapitulatif', content: <p>{quantity} amphores · 280 ob.</p> },
      ]}
    />
  );
}

describe('Stepper', () => {
  const current = () =>
    screen
      .getAllByRole('listitem')
      .filter((item) => item.getAttribute('aria-current') === 'step')
      .map((item) => item.textContent);

  it('annonce l’étape courante, n’avance qu’avec une saisie valable et porte le foyer sur le titre', () => {
    render(<Harness onConfirm={() => undefined} />);
    expect(screen.getByRole('list', { name: 'Étapes' })).toBeTruthy();
    expect(current()).toEqual(['Quantité']);
    const next = screen.getByRole('button', { name: 'Continuer' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Amphores'), { target: { value: '20' } });
    fireEvent.click(next);
    expect(current()).toEqual(['Note']);
    const heading = screen.getByRole('heading', { name: 'Étape 2 sur 3 Note' });
    expect(document.activeElement).toBe(heading);
  });

  it('revient en arrière sans perdre la saisie, et confirme sur le récapitulatif', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText('Amphores'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Pour Corinthe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect((screen.getByLabelText('Amphores') as HTMLInputElement).value).toBe('20');
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect((screen.getByLabelText('Note') as HTMLInputElement).value).toBe('Pour Corinthe');
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByText('20 amphores · 280 ob.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('bloque Confirmer tant que le récapitulatif n’est pas valable', () => {
    const onConfirm = vi.fn();
    render(
      <Stepper
        labels={labels}
        onConfirm={onConfirm}
        steps={[
          { id: 'quantity', title: 'Quantité', content: <p>20</p> },
          {
            id: 'summary',
            title: 'Récapitulatif',
            valid: false,
            content: <p>Fonds insuffisants</p>,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    const confirm = screen.getByRole('button', { name: 'Confirmer' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('dans une feuille : la tabulation boucle, Échap ferme et rend le foyer', () => {
    function InSheet() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Vendre</Button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Vendre" closeLabel="Fermer">
            <Harness onConfirm={() => undefined} />
          </Sheet>
        </>
      );
    }
    render(<InSheet />);
    const trigger = screen.getByRole('button', { name: 'Vendre' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('Amphores'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    const close = screen.getByRole('button', { name: 'Fermer' });
    const next = screen.getByRole('button', { name: 'Continuer' });
    next.focus();
    fireEvent.keyDown(next, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
