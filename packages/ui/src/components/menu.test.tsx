// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Archive, Ban, Flag } from '../icons';
import { Menu } from './Menu';

afterEach(cleanup);

const chosen = vi.fn();
/** Trois gestes, le dernier dans un groupe à part ; `reopenOn` rouvre le menu sur un geste. */
function Gestures({ reopenOn = null }: { reopenOn?: string | null }) {
  return (
    <>
      <Menu
        label="Autres gestes"
        reopenOn={reopenOn}
        items={[
          {
            id: 'g-ban',
            label: 'Exclure',
            icon: <Ban />,
            danger: true,
            onSelect: () => chosen('ban'),
          },
          { id: 'g-flag', label: 'Retenir', icon: <Flag />, onSelect: () => chosen('flag') },
          {
            id: 'g-archive',
            label: 'Classer',
            icon: <Archive />,
            separated: true,
            onSelect: () => chosen('archive'),
          },
        ]}
      />
      <button type="button">Après</button>
    </>
  );
}
const trigger = () => screen.getByRole('button', { name: 'Autres gestes' });
const item = (name: string) => screen.getByRole('menuitem', { name });
const key = (key: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key });

describe('Menu', () => {
  it('un bouton qui annonce son menu ; les gestes ont leur icône décorative et un séparateur de groupe', () => {
    render(<Gestures />);
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Autres gestes' });
    expect(trigger().getAttribute('aria-controls')).toBe(menu.id);
    expect(screen.getAllByRole('menuitem').map((node) => node.textContent)).toEqual([
      'Exclure',
      'Retenir',
      'Classer',
    ]);
    expect(item('Exclure').querySelector('[aria-hidden="true"] svg')).toBeTruthy();
    expect(item('Exclure').className).toContain('text-danger');
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    // Au clic, le foyer va au premier geste ; un second clic referme.
    expect(document.activeElement).toBe(item('Exclure'));
    fireEvent.click(trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('au clavier : ↓ et ↑ ouvrent aux bouts, parcourent en boucle ; Début, Fin ; Échap rend le foyer au bouton', () => {
    render(<Gestures />);
    trigger().focus();
    key('ArrowUp');
    expect(document.activeElement).toBe(item('Classer'));
    key('ArrowDown');
    expect(document.activeElement).toBe(item('Exclure'));
    key('ArrowUp');
    expect(document.activeElement).toBe(item('Classer'));
    key('Home');
    expect(document.activeElement).toBe(item('Exclure'));
    key('End');
    expect(document.activeElement).toBe(item('Classer'));
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    key('ArrowDown');
    expect(document.activeElement).toBe(item('Exclure'));
    // Tab referme le menu, sans retenir le foyer.
    key('Tab');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('un geste choisi referme le menu, rend le foyer au bouton, puis agit ; un appui au dehors referme', () => {
    chosen.mockReset();
    render(<Gestures />);
    trigger().focus();
    key('ArrowDown');
    key('ArrowDown');
    fireEvent.click(document.activeElement as HTMLElement);
    expect(chosen.mock.calls).toEqual([['flag']]);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Après' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('rouvre sur le geste demandé, le foyer dessus ; un identifiant inconnu ne rouvre rien', () => {
    const { rerender } = render(<Gestures />);
    rerender(<Gestures reopenOn="g-inconnu" />);
    expect(screen.queryByRole('menu')).toBeNull();
    rerender(<Gestures reopenOn="g-archive" />);
    expect(document.activeElement).toBe(item('Classer'));
  });
});
