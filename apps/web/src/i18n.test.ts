import {
  COMMON_ERROR_CODES,
  FRAMEWORK_ERROR_CODES,
  HOUSE_CREATE_ERROR_CODES,
  HOUSE_RENAME_ERROR_CODES,
  MARKET_CANCEL_ORDER_ERROR_CODES,
  MARKET_PLACE_ORDER_ERROR_CODES,
  SITE_ACQUIRE_ERROR_CODES,
  SITE_COLLECT_ERROR_CODES,
  SITE_SET_RECIPE_ERROR_CODES,
} from '@oikos/contracts';
import { BLAZON_EMBLEMS, BLAZON_SHAPES, BLAZON_TINCTURES } from '@oikos/contracts';
import { INITIAL_CONFIG, SITE_TYPES, type GameConfig } from '@oikos/config';
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

describe('traductions', () => {
  it('fr et en ont exactement les mêmes clés', () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });

  it('chaque erreur métier et chaque élément de blason du contrat est traduit', () => {
    const expected = [
      ...[
        ...COMMON_ERROR_CODES,
        ...FRAMEWORK_ERROR_CODES,
        ...HOUSE_CREATE_ERROR_CODES,
        ...HOUSE_RENAME_ERROR_CODES,
        ...MARKET_CANCEL_ORDER_ERROR_CODES,
        ...MARKET_PLACE_ORDER_ERROR_CODES,
        ...SITE_ACQUIRE_ERROR_CODES,
        ...SITE_COLLECT_ERROR_CODES,
        ...SITE_SET_RECIPE_ERROR_CODES,
      ].map((code) => `errors.${code}`),
      ...BLAZON_SHAPES.map((value) => `blazon.shape.${value}`),
      ...BLAZON_TINCTURES.map((value) => `blazon.tincture.${value}`),
      ...BLAZON_EMBLEMS.map((value) => `blazon.emblem.${value}`),
    ];
    expect(keys(fr)).toEqual(expect.arrayContaining(expected));
  });

  it('chaque bien et chaque recette de la configuration initiale a un nom', () => {
    const config = INITIAL_CONFIG as GameConfig;
    const expected = [
      ...config.goods.map((good) => `goods.${good.id}`),
      ...config.recipes.map((recipe) => `recipes.${recipe.id}`),
      ...config.npcClasses.map((npcClass) => `npcClasses.${npcClass.id}`),
      ...SITE_TYPES.map((type) => `siteTypes.${type}`),
    ];
    expect(keys(fr)).toEqual(expect.arrayContaining(expected));
  });

  it('les biens nommés sont exactement ceux de la configuration : l’agora ne propose rien d’autre', () => {
    const config = INITIAL_CONFIG as GameConfig;
    expect(Object.keys(fr.goods).sort()).toEqual(config.goods.map((good) => good.id).sort());
  });
});

describe('detectLanguage', () => {
  it('suit la préférence du navigateur, français par défaut', () => {
    expect(detectLanguage(['en-GB', 'fr'])).toBe('en');
    expect(detectLanguage(['fr-CA'])).toBe('fr');
    expect(detectLanguage(['de-DE', 'en'])).toBe('en');
    expect(detectLanguage(['el'])).toBe('fr');
    expect(detectLanguage([])).toBe('fr');
  });
});
