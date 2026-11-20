/** Thème d'Olympe : clair ou sombre, mémorisé sur l'appareil ; sans choix, celui du système (ADR 0011). */
export type Theme = 'light' | 'dark';

/** Clé du choix mémorisé sur l'appareil. */
export const THEME_KEY = 'oikos.olympe.theme';

/**
 * Pose le thème au chargement, avant le premier rendu (`main.tsx`) : le choix mémorisé, sinon celui de
 * l'appareil. Rien n'est écrit : sans choix, l'appareil décide encore au chargement suivant. Pas de script
 * dans `index.html` : la politique de contenu d'Olympe n'en admet aucun en ligne.
 */
export function loadTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_KEY);
  } catch {
    // Stockage indisponible (navigation privée) : l'appareil décide.
  }
  const theme =
    stored === 'dark' || stored === 'light'
      ? stored
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.dataset['theme'] = theme;
  return theme;
}

/** Thème affiché : celui que porte la racine du document. */
export const shownTheme = (): Theme =>
  document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';

/** Affiche le thème et le mémorise ; un stockage indisponible (navigation privée) ne l'empêche pas. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Préférence non mémorisée : sans conséquence.
  }
}
