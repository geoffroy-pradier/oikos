import { ROLE_MANAGER_ROLES, type AdminRole } from './admin';
import { MODERATION_ROLES } from './moderation-admin';

/**
 * Modules d'Olympe et rôles qui y ont accès (docs/specs/15-back-office-olympe.md, 15.3). Liste unique :
 * l'API ouvre ses routes de lecture d'après elle, le client compose sa navigation d'après elle. L'API
 * fait foi : le client ne s'en sert que pour ne pas proposer ce qui serait refusé.
 */
export const ADMIN_MODULE_ROLES = {
  /** Vigie et paramètres : tableaux de bord, fermés aux rôles de modération et de support. */
  vigie: ['super_admin', 'game_designer', 'observer'],
  /** Économie : masse monétaire, robinets et puits (`GET /api/admin/economy`). */
  economy: ['super_admin', 'game_designer', 'observer'],
  config: ['super_admin', 'game_designer', 'observer'],
  /** Animation : calendrier des événements du monde, en lecture (`GET /api/admin/events`, #267). */
  animation: ['super_admin', 'game_designer', 'community_manager', 'observer'],
  /**
   * Modération : file des signalements, appels, exclusions à valider (`GET /api/admin/reports`, #276). Mêmes rôles
   * que ses commandes ; le modérateur, peut-être bénévole, n'y lit aucune donnée économique.
   */
  moderation: MODERATION_ROLES,
  audit: ['super_admin', 'observer'],
  /** Accès : qui porte quel rôle. Mêmes comptes que ceux qui accordent et retirent les rôles. */
  access: ROLE_MANAGER_ROLES,
} as const satisfies Record<string, readonly AdminRole[]>;
export type AdminModule = keyof typeof ADMIN_MODULE_ROLES;
export const ADMIN_MODULES = Object.keys(ADMIN_MODULE_ROLES) as AdminModule[];

/** Modules ouverts à un rôle, dans l'ordre de la navigation. */
export function adminModulesFor(role: AdminRole): AdminModule[] {
  return ADMIN_MODULES.filter((id) => ADMIN_MODULE_ROLES[id].some((allowed) => allowed === role));
}
