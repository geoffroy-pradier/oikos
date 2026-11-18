import {
  ADMIN_CANCEL_ACTIVATION_ERROR_CODES,
  ADMIN_CONFIRM_EXCLUSION_ERROR_CODES,
  ADMIN_DECIDE_APPEAL_ERROR_CODES,
  ADMIN_HIDE_MESSAGE_ERROR_CODES,
  ADMIN_RESOLVE_REPORT_ERROR_CODES,
  ADMIN_SANCTION_ERROR_CODES,
  ADMIN_GRANT_ROLE_ERROR_CODES,
  ADMIN_PUBLISH_CONFIG_ERROR_CODES,
  ADMIN_REVOKE_ROLE_ERROR_CODES,
  ADMIN_ROLES,
  ADMIN_SCHEDULE_CONFIG_ERROR_CODES,
} from '@oikos/contracts';
import { SYSTEM_ACCOUNT_KEYS } from '@oikos/sim';
import { describe, expect, it } from 'vitest';
import { detectLanguage } from './i18n';
import en from './locales/en.json';
import fr from './locales/fr.json';

function keys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    keys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('traductions du back-office', () => {
  it('fr et en ont exactement les mêmes clés', () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });

  it('chaque robinet et chaque puits a un libellé dans les deux langues', () => {
    const labels = SYSTEM_ACCOUNT_KEYS.map((key) => `economy.accounts.${key}`);
    expect(keys(fr)).toEqual(expect.arrayContaining(labels));
    expect(keys(en)).toEqual(expect.arrayContaining(labels));
  });

  it('chaque rôle du contrat a un nom', () => {
    expect(keys(fr)).toEqual(expect.arrayContaining(ADMIN_ROLES.map((role) => `roles.${role}`)));
  });

  it('chaque refus des commandes de rôle a son message', () => {
    const codes = [...ADMIN_GRANT_ROLE_ERROR_CODES, ...ADMIN_REVOKE_ROLE_ERROR_CODES];
    expect(keys(fr)).toEqual(expect.arrayContaining(codes.map((code) => `access.errors.${code}`)));
  });

  it('chaque refus des commandes de configuration a son message (le refus du schéma a le sien)', () => {
    const codes = [
      ...ADMIN_PUBLISH_CONFIG_ERROR_CODES,
      ...ADMIN_SCHEDULE_CONFIG_ERROR_CODES,
      ...ADMIN_CANCEL_ACTIVATION_ERROR_CODES,
    ];
    const listed = codes.filter((code) => code !== 'CONFIG_INVALID');
    expect(listed).toEqual(
      expect.arrayContaining(['CONFIG_CLOCK_CHANGED', 'CONFIG_TIMEZONE_UNKNOWN']),
    );
    expect(keys(fr)).toEqual(expect.arrayContaining(listed.map((code) => `config.errors.${code}`)));
    expect(keys(fr)).toContain('config.invalidConfig');
  });

  it('chaque refus des commandes de modération a son message, dans les deux langues', () => {
    const codes = [
      ...ADMIN_SANCTION_ERROR_CODES,
      ...ADMIN_CONFIRM_EXCLUSION_ERROR_CODES,
      ...ADMIN_HIDE_MESSAGE_ERROR_CODES,
      ...ADMIN_RESOLVE_REPORT_ERROR_CODES,
      ...ADMIN_DECIDE_APPEAL_ERROR_CODES,
    ];
    for (const locale of [fr, en])
      expect(keys(locale)).toEqual(
        expect.arrayContaining(codes.map((code) => `moderation.errors.${code}`)),
      );
  });

  it('français par défaut, anglais si le navigateur le demande', () => {
    expect(detectLanguage(['en-GB'])).toBe('en');
    expect(detectLanguage(['el'])).toBe('fr');
  });
});
