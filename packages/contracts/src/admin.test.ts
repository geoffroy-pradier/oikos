import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROLES,
  adminCancelActivationInputSchema,
  adminCancelActivationOutputSchema,
  adminGrantRoleInputSchema,
  adminGrantRoleOutputSchema,
  adminRevokeRoleInputSchema,
  adminRevokeRoleOutputSchema,
  domainEventSchema,
  ROLE_MANAGER_ROLES,
} from './index';

const account = '00000000-0000-4000-8000-00000000000a';
const other = '00000000-0000-4000-8000-00000000000b';

describe('admin.grantRole et admin.revokeRole', () => {
  it('ne sont ouvertes qu’au super-administrateur (15.3)', () => {
    expect(ROLE_MANAGER_ROLES).toEqual(['super_admin']);
  });

  it.each(ADMIN_ROLES)('accorde le rôle « %s »', (role) => {
    expect(adminGrantRoleInputSchema.parse({ userId: account, role })).toEqual({
      userId: account,
      role,
    });
  });

  it('refuse un rôle hors liste, un compte qui n’est pas un identifiant, un champ en plus', () => {
    for (const input of [
      { userId: account, role: 'god' },
      { userId: account },
      { userId: 'alice@example.test', role: 'observer' },
      { userId: account, role: 'observer', grantedBy: other },
    ]) {
      expect(adminGrantRoleInputSchema.safeParse(input).success).toBe(false);
    }
    expect(
      adminRevokeRoleInputSchema.safeParse({ userId: account, role: 'observer' }).success,
    ).toBe(false);
    expect(adminRevokeRoleInputSchema.safeParse({}).success).toBe(false);
    expect(adminRevokeRoleInputSchema.parse({ userId: account })).toEqual({ userId: account });
  });

  it('rend le rôle précédent : absent pour un premier rôle, obligatoire pour un retrait', () => {
    const granted = { userId: account, role: 'observer', previousRole: null };
    expect(adminGrantRoleOutputSchema.parse(granted)).toEqual(granted);
    expect(
      adminGrantRoleOutputSchema.safeParse({ userId: account, role: 'observer' }).success,
    ).toBe(false);
    expect(
      adminRevokeRoleOutputSchema.safeParse({ userId: account, previousRole: null }).success,
    ).toBe(false);
  });

  it('laisse un événement de domaine qui nomme le compte, le rôle et l’auteur', () => {
    const granted = {
      type: 'AdminRoleGranted',
      payload: { userId: account, role: 'support', previousRole: 'observer', grantedBy: other },
    };
    const revoked = {
      type: 'AdminRoleRevoked',
      payload: { userId: account, previousRole: 'support', revokedBy: other },
    };
    expect(domainEventSchema.parse(granted)).toEqual(granted);
    expect(domainEventSchema.parse(revoked)).toEqual(revoked);
    const anonymous = { userId: account, role: 'support', previousRole: 'observer' };
    expect(domainEventSchema.safeParse({ ...granted, payload: anonymous }).success).toBe(false);
    expect(
      domainEventSchema.safeParse({ ...revoked, payload: { ...revoked.payload, role: 'support' } })
        .success,
    ).toBe(false);
  });
});

describe('admin.cancelActivation', () => {
  const cancelled = {
    activationId: account,
    versionId: other,
    activateAt: '2026-11-15T04:00:00.000Z',
  };

  it('désigne une programmation par son identifiant, sans autre champ', () => {
    expect(adminCancelActivationInputSchema.parse({ activationId: account })).toEqual({
      activationId: account,
    });
    for (const input of [{}, { activationId: 'a1' }, { versionId: other }, { ...cancelled }]) {
      expect(adminCancelActivationInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it('rend la version et la clôture annulées, et laisse un événement qui nomme l’auteur', () => {
    expect(adminCancelActivationOutputSchema.parse(cancelled)).toEqual(cancelled);
    expect(
      adminCancelActivationOutputSchema.safeParse({ ...cancelled, activateAt: 'demain' }).success,
    ).toBe(false);
    const event = {
      type: 'ConfigActivationCancelled',
      payload: { ...cancelled, cancelledBy: other },
    };
    expect(domainEventSchema.parse(event)).toEqual(event);
    expect(domainEventSchema.safeParse({ ...event, payload: cancelled }).success).toBe(false);
  });
});
