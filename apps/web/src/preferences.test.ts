// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  chooseTheme,
  initialTheme,
  storedLanguage,
  storedThemeChoice,
  storeLanguage,
} from './preferences';

function stubBrowser(initial: Record<string, string> = {}, broken = false) {
  const store = new Map(Object.entries(initial));
  const dataset: Record<string, string> = {};
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => {
        if (broken) throw new Error('storage disabled');
        return store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (broken) throw new Error('storage disabled');
        store.set(key, value);
      },
      removeItem: (key: string) => {
        if (broken) throw new Error('storage disabled');
        store.delete(key);
      },
    },
  });
  vi.stubGlobal('document', { documentElement: { dataset } });
  return { store, dataset };
}

afterEach(() => vi.unstubAllGlobals());

describe('préférences du joueur', () => {
  it('le thème mémorisé l’emporte sur celui du système', () => {
    stubBrowser({ 'oikos.theme': 'light' });
    expect(initialTheme(true)).toBe('light');
  });

  it('sans préférence, ou avec une valeur inconnue, suit le système', () => {
    stubBrowser({ 'oikos.theme': 'neon' });
    expect([initialTheme(true), initialTheme(false)]).toEqual(['dark', 'light']);
  });

  it('applique le thème sur <html> et ne le mémorise que si demandé', () => {
    const { store, dataset } = stubBrowser();
    applyTheme('dark', false);
    expect([dataset['theme'], store.has('oikos.theme')]).toEqual(['dark', false]);
    applyTheme('light');
    expect([dataset['theme'], store.get('oikos.theme')]).toEqual(['light', 'light']);
  });

  it('Réglages : un thème choisi est appliqué et mémorisé, celui de l’appareil efface la mémoire', () => {
    const { store, dataset } = stubBrowser();
    expect(storedThemeChoice()).toBe('system');
    expect(chooseTheme('dark', false)).toBe('dark');
    expect([dataset['theme'], store.get('oikos.theme'), storedThemeChoice()]).toEqual([
      'dark',
      'dark',
      'dark',
    ]);
    // Appareil en clair : le thème suit le système, et plus rien n'est mémorisé.
    expect(chooseTheme('system', false)).toBe('light');
    expect([dataset['theme'], store.has('oikos.theme'), storedThemeChoice()]).toEqual([
      'light',
      false,
      'system',
    ]);
    expect(initialTheme(true)).toBe('dark');
    expect(chooseTheme('system', true)).toBe('dark');
  });

  it('mémorise la langue et ignore une valeur hors liste', () => {
    stubBrowser({ 'oikos.language': 'de' });
    expect(storedLanguage()).toBeNull();
    storeLanguage('en');
    expect(storedLanguage()).toBe('en');
  });

  it('fonctionne quand le stockage est indisponible (navigation privée)', () => {
    const { dataset } = stubBrowser({}, true);
    expect(storedLanguage()).toBeNull();
    expect(initialTheme(false)).toBe('light');
    expect(() => applyTheme('dark')).not.toThrow();
    expect(dataset['theme']).toBe('dark');
    expect(chooseTheme('system', false)).toBe('light');
    expect([dataset['theme'], storedThemeChoice()]).toEqual(['light', 'system']);
  });
});
