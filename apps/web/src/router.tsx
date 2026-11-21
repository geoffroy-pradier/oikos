import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AccountsScreen } from './screens/Accounts';
import { AgoraScreen } from './screens/Agora';
import { CityScreen } from './screens/City';
import { HomeScreen } from './screens/Home';
import { HouseProfileScreen } from './screens/HouseProfile';
import { LiturgyScreen } from './screens/Liturgy';
import { MapScreen } from './screens/Map';
import { MessagesScreen } from './screens/Messages';
import { PropertyScreen } from './screens/Property';
import { ShipScreen } from './screens/Ship';
import { SitesScreen } from './screens/Sites';
import { StaffScreen } from './screens/Staff';
import { TempleScreen } from './screens/Temple';
import { NotFound } from './screens/NotFound';
import { Shell } from './Shell';

export { TABS, tabOf, type TabId } from './tabs';

const rootRoute = createRootRoute({ component: Shell });
const route = <P extends string>(path: P, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const routeTree = rootRoute.addChildren([
  route('/', HomeScreen),
  // Écrans de l'onglet Maison, ouverts depuis le tableau de bord.
  route('/sites', SitesScreen),
  route('/comptes', AccountsScreen),
  route('/personnel', StaffScreen),
  route('/immobilier', PropertyScreen),
  route('/carte', MapScreen),
  route('/carte/navire/$shipId', ShipScreen),
  route('/agora', AgoraScreen),
  route('/cite', CityScreen),
  route('/cite/temple', TempleScreen),
  // Liturgie de la maison (6.4), ouverte depuis l'alerte du tableau de bord et l'onglet Cité.
  route('/cite/liturgie', LiturgyScreen),
  route('/messages', MessagesScreen),
  // Fiche publique d'une maison (6.6), ouverte depuis un message, un candidat ou un magistrat.
  route('/maison/$houseId', HouseProfileScreen),
]);

// Adresse inconnue : écran traduit, jamais le texte par défaut du routeur.
export const router = createRouter({ routeTree, defaultNotFoundComponent: NotFound });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
