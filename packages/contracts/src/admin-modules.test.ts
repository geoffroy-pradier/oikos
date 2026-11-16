import { describe, expect, it } from 'vitest';
import { ADMIN_MODULES, ADMIN_ROLES, adminModulesFor } from './index';

describe('modules d’Olympe par rôle (15.3)', () => {
  it('ouvre à chaque rôle exactement ses modules, dans l’ordre de la navigation', () => {
    expect(ADMIN_MODULES).toEqual(['vigie', 'economy', 'config', 'animation', 'audit', 'access']);
    expect(Object.fromEntries(ADMIN_ROLES.map((role) => [role, adminModulesFor(role)]))).toEqual({
      super_admin: ['vigie', 'economy', 'config', 'animation', 'audit', 'access'],
      game_designer: ['vigie', 'economy', 'config', 'animation'],
      community_manager: ['animation'],
      // Bénévoles possibles : aucune donnée économique, pas même les tableaux de bord (15.4).
      moderator: [],
      support: [],
      observer: ['vigie', 'economy', 'config', 'animation', 'audit'],
    });
  });
});
