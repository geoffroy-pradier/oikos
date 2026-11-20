// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { centerActive, fadeEdges, revealItem } from './scroll-row';
import { PillTabs } from './Tabs';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('fadeEdges', () => {
  it('un fondu sur chaque bord où il reste du contenu, aucun sans débordement', () => {
    expect(fadeEdges({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 })).toBe('');
    expect(fadeEdges({ scrollLeft: 0, clientWidth: 300, scrollWidth: 500 })).toBe('end');
    expect(fadeEdges({ scrollLeft: 100, clientWidth: 300, scrollWidth: 500 })).toBe('start end');
    expect(fadeEdges({ scrollLeft: 200, clientWidth: 300, scrollWidth: 500 })).toBe('start');
    // Défilement fractionnaire (zoom) : un demi-pixel n'est pas du contenu caché.
    expect(fadeEdges({ scrollLeft: 199.5, clientWidth: 300, scrollWidth: 500 })).toBe('start');
  });
});

/**
 * Rangée de 300 px pour 600 px de contenu, dont chaque élément mesure 100 px, à sa place dans le contenu
 * défilé ; le défilement est borné comme dans un navigateur.
 */
function lay(row: HTMLElement) {
  let left = 0;
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 600 });
  Object.defineProperty(row, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (value: number) => {
      left = Math.min(Math.max(value, 0), 300);
    },
  });
  row.getBoundingClientRect = () => ({ left: 0 }) as DOMRect;
  [...row.children].forEach((child, index) => {
    const item = child as HTMLElement;
    Object.defineProperty(item, 'offsetWidth', { configurable: true, value: 100 });
    item.getBoundingClientRect = () => ({ left: index * 100 - row.scrollLeft }) as DOMRect;
  });
}

describe('centerActive', () => {
  it('centre l’élément actif, quel que soit son marquage', () => {
    for (const mark of ['aria-current="page"', 'aria-selected="true"', 'aria-checked="true"']) {
      const row = document.createElement('div');
      row.innerHTML = [0, 1, 2, 3, 4, 5].map((i) => `<a ${i === 3 ? mark : ''}>${i}</a>`).join('');
      lay(row);
      centerActive(row);
      // Le quatrième élément (300 à 400 px) au milieu de 300 px : 100 px de chaque côté.
      expect(row.scrollLeft).toBe(200);
    }
  });

  it('sans élément actif, la rangée ne bouge pas', () => {
    const row = document.createElement('div');
    row.innerHTML = '<a>a</a><a>b</a>';
    lay(row);
    centerActive(row);
    expect(row.scrollLeft).toBe(0);
  });
});

describe('revealItem', () => {
  it('montre en entier, hors du fondu, un élément en partie caché ; ne bouge pas pour un élément visible', () => {
    const row = document.createElement('div');
    row.innerHTML = [0, 1, 2, 3, 4, 5].map((i) => `<a>${i}</a>`).join('');
    // Marge de défilement de `scroll-fade`, que jsdom ne calcule pas.
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      scrollPaddingLeft: '24px',
    } as CSSStyleDeclaration);
    lay(row);
    const items = [...row.children] as HTMLElement[];
    revealItem(row, items[1] as HTMLElement);
    expect(row.scrollLeft).toBe(0);
    // Troisième élément (200 à 300 px), coupé par le fondu de droite : son bord droit à 300 - 24 px.
    revealItem(row, items[2] as HTMLElement);
    expect(row.scrollLeft).toBe(24);
    revealItem(row, items[5] as HTMLElement);
    expect(row.scrollLeft).toBe(300);
    // Retour au début : le bord gauche du premier élément à 24 px, borné à zéro.
    revealItem(row, items[0] as HTMLElement);
    expect(row.scrollLeft).toBe(0);
  });
});

describe('PillTabs qui défilent', () => {
  it('la rangée est la liste d’onglets, recentrée sur l’onglet choisi au clavier', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, label: id }));
    render(<PillTabs label="Cité" items={items} />);
    const list = screen.getByRole('tablist', { name: 'Cité' });
    expect(list.classList.contains('scroll-fade')).toBe(true);
    lay(list);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'a' }), { key: 'End' });
    // Dernier onglet (500 à 600 px) : la rangée va au bout, son fondu reste au début seulement.
    expect(list.scrollLeft).toBe(300);
    expect(list.dataset.fade).toBe('start');
  });
});
