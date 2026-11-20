// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applyTheme, loadTheme, shownTheme, THEME_KEY } from './theme';

afterEach(() => {
  delete document.documentElement.dataset['theme'];
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Thème de l'appareil, tel que `matchMedia` le dit (jsdom n'en fournit pas). */
const device = (dark: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: dark, media: query }));

it('au chargement : le choix mémorisé l’emporte sur l’appareil, rien n’est écrit sans choix', () => {
  device(true);
  expect(loadTheme()).toBe('dark');
  expect(shownTheme()).toBe('dark');
  expect(localStorage.getItem(THEME_KEY)).toBeNull();
  localStorage.setItem(THEME_KEY, 'light');
  expect(loadTheme()).toBe('light');
  device(false);
  localStorage.setItem(THEME_KEY, 'dark');
  expect(loadTheme()).toBe('dark');
  // Valeur étrangère : l'appareil décide.
  localStorage.setItem(THEME_KEY, 'sepia');
  expect(loadTheme()).toBe('light');
  vi.unstubAllGlobals();
});

it('au chargement, un stockage illisible laisse l’appareil décider', () => {
  device(true);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('refusé');
  });
  expect(loadTheme()).toBe('dark');
  vi.unstubAllGlobals();
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
