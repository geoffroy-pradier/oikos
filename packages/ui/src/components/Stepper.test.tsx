// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
