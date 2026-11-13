import { LANGUAGES, type Language } from './i18n';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const THEME_KEY = 'oikos.theme';
const LANGUAGE_KEY = 'oikos.language';

/** Lecture tolérante : le stockage peut être indisponible (navigation privée) ou contenir n'importe quoi. */
function read<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.find((candidate) => candidate === value) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Préférence non mémorisée : sans conséquence.
  }
}

export const storedLanguage = (): Language | null => read(LANGUAGE_KEY, LANGUAGES);
export const storeLanguage = (language: Language) => write(LANGUAGE_KEY, language);

/** Thème mémorisé, sinon celui du système. */
export function initialTheme(prefersDark: boolean): Theme {
  return read(THEME_KEY, THEMES) ?? (prefersDark ? 'dark' : 'light');
}

export function applyTheme(theme: Theme, persist = true): void {
  document.documentElement.dataset['theme'] = theme;
  if (persist) write(THEME_KEY, theme);
}
