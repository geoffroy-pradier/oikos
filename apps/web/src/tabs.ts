/** Les cinq onglets de la spécification 10 (Maison, Carte, Agora, Cité, Messages). */
export const TABS = [
  { id: 'house', to: '/' },
  { id: 'map', to: '/carte' },
  { id: 'agora', to: '/agora' },
  { id: 'city', to: '/cite' },
  { id: 'messages', to: '/messages' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

/** Écrans ouverts depuis un onglet sans en être la racine : l'onglet reste marqué actif. */
const TAB_SCREENS: Readonly<Record<string, TabId>> = {
  '/comptes': 'house',
  '/personnel': 'house',
  '/immobilier': 'house',
};

/**
 * Onglet actif pour un chemin : la racine d'un onglet ou une page sous elle (`/agora/…`), un écran
 * rattaché (`TAB_SCREENS`), sinon aucun.
 */
export function tabOf(pathname: string): TabId | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const screen = Object.entries(TAB_SCREENS).find(
    ([root]) => path === root || path.startsWith(`${root}/`),
  );
  if (screen) return screen[1];
  const under = (to: string) => path === to || (to !== '/' && path.startsWith(`${to}/`));
  return TABS.find((tab) => under(tab.to))?.id ?? null;
}
