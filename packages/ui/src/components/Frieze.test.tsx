// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Frieze } from './Frieze';

describe('Frieze', () => {
  it('est cachée aux lecteurs d’écran et suit le motif demandé', () => {
    const { container } = render(<Frieze pattern="wave" tone="aegean" />);
    const frieze = container.firstElementChild;
    expect(frieze?.getAttribute('aria-hidden')).toBe('true');
    expect(frieze?.className).toContain('frieze-wave');
    expect(frieze?.getAttribute('style')).toContain('var(--aegean)');
  });
});
