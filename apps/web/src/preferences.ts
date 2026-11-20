import { LANGUAGES, type Language } from './i18n';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
/** Choix offert par les Réglages : un thème, ou celui de l'appareil (rien de mémorisé). */
export const THEME_CHOICES = [...THEMES, 'system'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

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

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
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

/** Choix mémorisé ; sans thème mémorisé, celui de l'appareil. */
export const storedThemeChoice = (): ThemeChoice => read(THEME_KEY, THEMES) ?? 'system';

/**
 * Applique un choix des Réglages et le mémorise. Celui de l'appareil efface le thème mémorisé : la règle
 * d'`index.html` et d'`initialTheme` (rien de mémorisé, le système décide) reste la seule à lire.
 */
export function chooseTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  const theme = choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice;
  applyTheme(theme, false);
  write(THEME_KEY, choice === 'system' ? null : choice);
  return theme;
}
