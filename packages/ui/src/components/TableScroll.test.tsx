// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TableScroll } from './TableScroll';

afterEach(cleanup);

/** Cadre de 300 px pour 600 px de contenu, ou sans débordement. */
function size(scrollWidth: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    value: scrollWidth,
  });
}

describe('TableScroll', () => {
  it('plus large que son cadre : fondu sur le bord caché, région au clavier nommée par le tableau', () => {
    size(600);
    const { container } = render(
      <TableScroll label="Compte de résultat">
        <table />
      </TableScroll>,
    );
    const region = screen.getByRole('region', { name: 'Compte de résultat' });
    expect(region.tabIndex).toBe(0);
    expect(container.firstElementChild).toBe(region);
    expect(region.dataset['fade']).toBe('end');
    expect(region.className).toContain('scroll-fade');
    // Défilé jusqu'au bout : le fondu passe du côté de l'arrivée.
    Object.defineProperty(region, 'scrollLeft', { configurable: true, value: 300 });
    fireEvent.scroll(region);
    expect(region.dataset['fade']).toBe('start');
  });

  it('qui tient dans son cadre : aucun fondu, aucun arrêt de tabulation', () => {
    size(300);
    const { container } = render(
      <TableScroll label="Prix">
        <table />
      </TableScroll>,
    );
    expect(screen.queryByRole('region')).toBeNull();
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.hasAttribute('tabindex')).toBe(false);
    expect(frame.dataset['fade']).toBe('');
  });
});
