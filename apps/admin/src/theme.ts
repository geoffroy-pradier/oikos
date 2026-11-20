/** Thème d'Olympe : clair ou sombre, mémorisé sur l'appareil ; sans choix, celui du système (ADR 0011). */
export type Theme = 'light' | 'dark';

/** Même clé que la règle d'`index.html`, qui pose le thème avant le premier affichage. */
export const THEME_KEY = 'oikos.olympe.theme';

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
