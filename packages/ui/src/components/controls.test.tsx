// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ship } from '../icons';
import { Badge } from './Badge';
import { Button } from './Button';
import { Stat } from './Stat';

afterEach(cleanup);

describe('Button', () => {
  it('garde son nom et son type par défaut ; l’icône est décorative', () => {
    render(<Button icon={<Ship data-testid="icon" />}>Partir</Button>);
    const button = screen.getByRole('button', { name: 'Partir' });
    expect(button.getAttribute('type')).toBe('button');
    expect(screen.getByTestId('icon').getAttribute('aria-hidden')).toBe('true');
  });

  it('en chargement : inactif, occupé, même nom, et ne reçoit plus de clic', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Vendre
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Vendre' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('hors chargement, n’annonce pas d’occupation', () => {
    render(<Button variant="danger">Retirer</Button>);
    expect(screen.getByRole('button').hasAttribute('aria-busy')).toBe(false);
  });
});

describe('Badge', () => {
  it('porte son texte et son ton', () => {
    render(<Badge tone="success">Payé</Badge>);
    expect(screen.getByText('Payé').className).toContain('text-success');
  });
});

describe('Stat', () => {
  it('dit libellé, valeur et variation ; la flèche double le sens par la forme', () => {
    const { container } = render(
      <Stat label="Charges" value="96" delta={{ value: '+3 %', trend: 'up', tone: 'negative' }} />,
    );
    expect(screen.getByText('Charges')).toBeTruthy();
    expect(screen.getByText('96')).toBeTruthy();
    const delta = screen.getByText('+3 %');
    expect(delta.dataset['trend']).toBe('up');
    expect(delta.className).toContain('text-danger');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('par défaut, une baisse est défavorable', () => {
    render(<Stat label="Production" value="312" delta={{ value: '−8 %', trend: 'down' }} />);
    expect(screen.getByText('−8 %').className).toContain('text-danger');
  });
});
