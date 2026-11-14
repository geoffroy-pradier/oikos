import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AccountsScreen } from './screens/Accounts';
import { AgoraScreen } from './screens/Agora';
import { HomeScreen } from './screens/Home';
import { NotFound } from './screens/NotFound';
import { Placeholder } from './screens/Placeholder';
import { Shell } from './Shell';

/** Les cinq onglets de la spécification 10 (Maison, Carte, Agora, Cité, Messages). */
export const TABS = [
  { id: 'house', to: '/' },
  { id: 'map', to: '/carte' },
  { id: 'agora', to: '/agora' },
  { id: 'city', to: '/cite' },
  { id: 'messages', to: '/messages' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

const rootRoute = createRootRoute({ component: Shell });
const route = <P extends string>(path: P, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const routeTree = rootRoute.addChildren([
  route('/', HomeScreen),
  // Écrans de l'onglet Maison, ouverts depuis le tableau de bord.
  route('/comptes', AccountsScreen),
  route('/carte', () => <Placeholder tab="map" />),
  route('/agora', AgoraScreen),
  route('/cite', () => <Placeholder tab="city" />),
  route('/messages', () => <Placeholder tab="messages" />),
]);

// Adresse inconnue : écran traduit, jamais le texte par défaut du routeur.
export const router = createRouter({ routeTree, defaultNotFoundComponent: NotFound });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
