import {
  ADMIN_GRANT_ROLE_ERROR_CODES,
  ADMIN_REVOKE_ROLE_ERROR_CODES,
  adminGrantRoleInputSchema,
  adminGrantRoleOutputSchema,
  adminRevokeRoleInputSchema,
  adminRevokeRoleOutputSchema,
  ROLE_MANAGER_ROLES,
  type AdminRole,
  type CommandError,
} from '@oikos/contracts';
import type { Db } from '@oikos/db';
import { sql } from 'kysely';
import { defineCommand } from '../registry';

/**
 * Refus prononcés par `admin.set_role`, sous son verrou : la base fait foi quand deux changements de
 * rôle se croisent (deux super-administrateurs qui se retirent l'un l'autre, par exemple).
 */
const ROLE_ERRORS: Record<string, CommandError> = {
  roles_changed_by_super_admin: {
    code: 'FORBIDDEN',
    message: 'Administrator role and two-factor session required.',
  },
  roles_account_exists: { code: 'ACCOUNT_NOT_FOUND', message: 'Unknown account.' },
  roles_not_self_granted: {
    code: 'ROLE_SELF_GRANT',
    message: 'An administrator does not change their own role.',
  },
  roles_keep_one_super_admin: {
    code: 'LAST_SUPER_ADMIN',
    message: 'The last super administrator cannot be removed.',
  },
};

/** Applique le changement en base et rend le rôle que le compte portait. */
async function setRole(trx: Db, actor: string, target: string, role: AdminRole | null) {
  const changed = await sql<{ previous: AdminRole | null }>`
    select admin.set_role(${actor}, ${target}, ${role}) as previous`.execute(trx);
  return changed.rows[0]?.previous ?? null;
}

/** Accorde un rôle d'administration, ou remplace celui du compte (docs/specs/15-back-office-olympe.md, 15.3). */
export const adminGrantRole = defineCommand({
  name: 'admin.grantRole',
  admin: ROLE_MANAGER_ROLES,
  input: adminGrantRoleInputSchema,
  output: adminGrantRoleOutputSchema,
  errors: ADMIN_GRANT_ROLE_ERROR_CODES,
  errorByConstraint: ROLE_ERRORS,
  async handler({ trx, userId, emit }, { userId: target, role }) {
    const previousRole = await setRole(trx, userId, target, role);
    if (previousRole === role) {
      return {
        ok: false,
        error: { code: 'ROLE_UNCHANGED', message: 'The account already holds this role.' },
      };
    }
    emit({
      type: 'AdminRoleGranted',
      payload: { userId: target, role, previousRole, grantedBy: userId },
    });
    return { ok: true, data: { userId: target, role, previousRole } };
  },
});

/** Retire son rôle à un compte : il perd tout accès à Olympe dès la commande suivante. */
export const adminRevokeRole = defineCommand({
  name: 'admin.revokeRole',
  admin: ROLE_MANAGER_ROLES,
  input: adminRevokeRoleInputSchema,
  output: adminRevokeRoleOutputSchema,
  errors: ADMIN_REVOKE_ROLE_ERROR_CODES,
  errorByConstraint: ROLE_ERRORS,
  async handler({ trx, userId, emit }, { userId: target }) {
    const previousRole = await setRole(trx, userId, target, null);
    if (!previousRole) {
      return {
        ok: false,
        error: { code: 'ROLE_NOT_FOUND', message: 'The account holds no role.' },
      };
    }
    emit({
      type: 'AdminRoleRevoked',
      payload: { userId: target, previousRole, revokedBy: userId },
    });
    return { ok: true, data: { userId: target, previousRole } };
  },
});
