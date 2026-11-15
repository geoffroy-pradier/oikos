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
const TAB_SCREENS: Readonly<Record<string, TabId>> = { '/comptes': 'house' };

/** Onglet actif pour un chemin : la racine d'un onglet, un de ses écrans, sinon aucun. */
export function tabOf(pathname: string): TabId | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return TAB_SCREENS[path] ?? TABS.find((tab) => tab.to === path)?.id ?? null;
}
