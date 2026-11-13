import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

export const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Français par défaut ; anglais si le navigateur le demande. */
export function detectLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    const match = LANGUAGES.find((language) => language === base);
    if (match) return match;
  }
  return 'fr';
}

export async function initI18n(language: Language) {
  await i18n.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: language,
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
  });
  return i18n;
}
