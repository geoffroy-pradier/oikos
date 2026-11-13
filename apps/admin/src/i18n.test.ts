import { ADMIN_ROLES } from '@oikos/contracts';
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

  it('chaque rôle du contrat a un nom', () => {
    expect(keys(fr)).toEqual(expect.arrayContaining(ADMIN_ROLES.map((role) => `roles.${role}`)));
  });

  it('français par défaut, anglais si le navigateur le demande', () => {
    expect(detectLanguage(['en-GB'])).toBe('en');
    expect(detectLanguage(['el'])).toBe('fr');
  });
});
