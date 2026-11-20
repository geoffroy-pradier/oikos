// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Coins, Ship } from '../icons';
import { EmptyState } from './EmptyState';
import { Progress } from './Progress';
import { StatCard } from './StatCard';
import { StatusRegion } from './StatusRegion';

afterEach(cleanup);

describe('StatCard', () => {
  it('dit le sens par un triangle et la valeur signée, pas par la couleur seule', () => {
    render(
      <StatCard
        label="Charges"
        icon={<Coins />}
        value="96 dr."
        delta={{ value: '+3 %', trend: 'up', tone: 'negative' }}
        hint="depuis hier"
      />,
    );
    const delta = screen.getByText('+3 %', { exact: false });
    expect(delta.dataset['trend']).toBe('up');
    expect(delta.className).toContain('text-danger');
    expect(delta.querySelector('[aria-hidden="true"]')?.textContent).toBe('▲ ');
    expect(screen.getByText('96 dr.').className).toContain('tabular-nums');
  });
});

describe('Progress', () => {
  it('est une barre nommée, bornée, dont la valeur est dite en clair', () => {
    render(<Progress label="Moisson" value={7} max={5} valueText="5 jours sur 5" />);
    const bar = screen.getByRole('progressbar', { name: 'Moisson' });
    expect(bar.getAttribute('aria-valuenow')).toBe('5');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    expect(bar.getAttribute('aria-valuetext')).toBe('5 jours sur 5');
  });
});

describe('StatusRegion', () => {
  it('est présente vide avant le résultat, puis l’annonce sans être recréée', () => {
    const ref = createRef<HTMLDivElement>();
    const { rerender } = render(<StatusRegion ref={ref} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    rerender(
      <StatusRegion ref={ref} tone="success">
        Ordre passé
      </StatusRegion>,
    );
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('Ordre passé');
    ref.current?.focus();
    expect(document.activeElement).toBe(region);
  });

  it('prend le rôle alert pour une erreur', () => {
    render(<StatusRegion role="alert" tone="danger" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('montre une illustration décorative à la place de l’icône', () => {
    const { container } = render(
      <EmptyState
        icon={<Ship data-testid="icon" />}
        illustration={<svg data-testid="art" />}
        title="Rien"
      />,
    );
    expect(screen.getByTestId('art').parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-testid="icon"]')).toBeNull();
  });
});
