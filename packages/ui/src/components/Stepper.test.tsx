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

  it('Confirmer porte la description donnée, les autres boutons non', () => {
    render(
      <Stepper
        labels={labels}
        onConfirm={vi.fn()}
        confirmDescribedBy="net"
        steps={[
          { id: 'quantity', title: 'Quantité', content: <p>20</p> },
          { id: 'summary', title: 'Récapitulatif', content: <p id="net">Net : 19 ob.</p> },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Continuer' }).hasAttribute('aria-describedby')).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByRole('button', { name: 'Confirmer' }).getAttribute('aria-describedby')).toBe(
      'net',
    );
  });

  it('Retour est inactif pendant la commande en vol', () => {
    const steps = [
      { id: 'quantity', title: 'Quantité', content: <p>20</p> },
      { id: 'summary', title: 'Récapitulatif', content: <p>20 amphores</p> },
    ];
    const view = render(<Stepper labels={labels} onConfirm={vi.fn()} steps={steps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    const back = screen.getByRole('button', { name: 'Retour' }) as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    view.rerender(<Stepper labels={labels} onConfirm={vi.fn()} steps={steps} confirming />);
    expect(back.disabled).toBe(true);
    fireEvent.click(back);
    expect(screen.getByRole('heading', { name: /Récapitulatif/ })).toBeTruthy();
  });

  it('Confirmer retrouve le foyer perdu pendant la commande, quand elle échoue', () => {
    const steps = [{ id: 'summary', title: 'Récapitulatif', content: <p>20 amphores</p> }];
    const view = render(<Stepper labels={labels} onConfirm={vi.fn()} steps={steps} />);
    const confirm = screen.getByRole('button', { name: 'Confirmer' });
    confirm.focus();
    view.rerender(<Stepper labels={labels} onConfirm={vi.fn()} steps={steps} confirming />);
    // Le navigateur retire le foyer au bouton devenu inactif.
    confirm.blur();
    view.rerender(<Stepper labels={labels} onConfirm={vi.fn()} steps={steps} />);
    expect(document.activeElement).toBe(confirm);
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

  it('Entrée dans un champ avance ; une étape gardée par check reste en place', () => {
    let allowed = false;
    render(
      <Stepper
        labels={labels}
        onConfirm={() => undefined}
        steps={[
          {
            id: 'name',
            title: 'Nom',
            check: () => allowed,
            content: <input aria-label="Nom" />,
          },
          { id: 'summary', title: 'Récapitulatif', content: <p>Fin</p> },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText('Nom'), { key: 'Enter' });
    expect(current()).toEqual(['Nom']);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(current()).toEqual(['Nom']);
    allowed = true;
    fireEvent.keyDown(screen.getByLabelText('Nom'), { key: 'Enter' });
    expect(current()).toEqual(['Récapitulatif']);
  });

  it('Entrée qui valide une composition IME n’avance pas', () => {
    render(
      <Stepper
        labels={labels}
        onConfirm={() => undefined}
        steps={[
          { id: 'name', title: 'Nom', content: <input aria-label="Nom" /> },
          { id: 'summary', title: 'Récapitulatif', content: <p>Fin</p> },
        ]}
      />,
    );
    const field = screen.getByLabelText('Nom');
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(current()).toEqual(['Nom']);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(current()).toEqual(['Récapitulatif']);
  });

  it('commence par l’étape demandée, sans voler le foyer', () => {
    render(
      <Stepper
        labels={labels}
        onConfirm={() => undefined}
        initialStep="summary"
        steps={[
          { id: 'name', title: 'Nom', content: <p>Nom</p> },
          { id: 'summary', title: 'Récapitulatif', content: <p>Fin</p> },
        ]}
      />,
    );
    expect(current()).toEqual(['Récapitulatif']);
    expect(document.activeElement).toBe(document.body);
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
