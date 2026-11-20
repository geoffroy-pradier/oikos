// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applyTheme, shownTheme, THEME_KEY } from './theme';

afterEach(() => {
  delete document.documentElement.dataset['theme'];
  localStorage.clear();
  vi.restoreAllMocks();
});

it('le thème choisi est affiché et mémorisé ; sans attribut, le thème affiché est le clair', () => {
  expect(shownTheme()).toBe('light');
  applyTheme('dark');
  expect(shownTheme()).toBe('dark');
  expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  applyTheme('light');
  expect(document.documentElement.dataset['theme']).toBe('light');
  expect(localStorage.getItem(THEME_KEY)).toBe('light');
});

it('un stockage indisponible n’empêche pas de changer de thème', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  applyTheme('dark');
  expect(shownTheme()).toBe('dark');
});
