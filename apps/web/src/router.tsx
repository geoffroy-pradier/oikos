import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AccountsScreen } from './screens/Accounts';
import { AgoraScreen } from './screens/Agora';
import { CityScreen } from './screens/City';
import { HomeScreen } from './screens/Home';
import { MapScreen } from './screens/Map';
import { NotFound } from './screens/NotFound';
import { Placeholder } from './screens/Placeholder';
import { Shell } from './Shell';

export { TABS, tabOf, type TabId } from './tabs';

const rootRoute = createRootRoute({ component: Shell });
const route = <P extends string>(path: P, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const routeTree = rootRoute.addChildren([
  route('/', HomeScreen),
  // Écrans de l'onglet Maison, ouverts depuis le tableau de bord.
  route('/comptes', AccountsScreen),
  route('/carte', MapScreen),
  route('/agora', AgoraScreen),
  route('/cite', CityScreen),
  route('/messages', () => <Placeholder tab="messages" />),
]);

// Adresse inconnue : écran traduit, jamais le texte par défaut du routeur.
export const router = createRouter({ routeTree, defaultNotFoundComponent: NotFound });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
