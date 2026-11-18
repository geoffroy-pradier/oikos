// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ship } from '../icons';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { Tabs } from './Tabs';

afterEach(cleanup);

describe('Tabs', () => {
  const items = ['a', 'b', 'c'].map((id) => ({ id, label: `Tab ${id}`, content: `Panel ${id}` }));

  it('relie onglets et panneau ; un seul onglet est un arrêt de tabulation', () => {
    render(<Tabs label="Agora" items={items} defaultValue="b" />);
    expect(screen.getByRole('tablist', { name: 'Agora' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel', { name: 'Tab b' });
    expect(panel.textContent).toBe('Panel b');
    expect(tabs[1]?.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('se parcourt aux flèches (en boucle), Début et Fin, le foyer suivant la sélection', () => {
    const onValueChange = vi.fn();
    render(<Tabs label="Agora" items={items} onValueChange={onValueChange} />);
    const [first, , last] = screen.getAllByRole('tab');
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(last);
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel c');
    fireEvent.keyDown(last as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first as HTMLElement, { key: 'End' });
    fireEvent.keyDown(last as HTMLElement, { key: 'Home' });
    expect(onValueChange.mock.calls.map(([id]) => id)).toEqual(['c', 'a', 'c', 'a']);
  });

  it('suit la valeur du parent quand elle est donnée', () => {
    const { rerender } = render(<Tabs label="Agora" items={items} value="a" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tab c' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel a');
    rerender(<Tabs label="Agora" items={items} value="b" />);
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel b');
  });
});

describe('EmptyState', () => {
  it('titre au niveau demandé, description et action', () => {
    render(
      <EmptyState
        headingLevel={2}
        icon={<Ship />}
        title="Aucun navire"
        description="Le chantier vend des navires."
        action={<Button>Ouvrir</Button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Aucun navire' })).toBeTruthy();
    expect(screen.getByText('Le chantier vend des navires.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ouvrir' })).toBeTruthy();
  });
});

describe('Skeleton', () => {
  it('est caché aux lecteurs d’écran', () => {
    const { container } = render(<Skeleton round />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});
