import { LanguageSelect as HeaderLanguageSelect, Select } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language } from './i18n';
import { storeLanguage } from './preferences';

/**
 * Choix de la langue, mémorisé : avant la connexion dans l'en-tête, le sélecteur partagé avec Olympe (`@oikos/ui`) ;
 * dans les Réglages (`field`), en champ libellé.
 */
export function LanguageSelect({ field = false }: { field?: boolean }) {
  const { t, i18n } = useTranslation();
  const choose = (language: string) => {
    storeLanguage(language as Language);
    void i18n.changeLanguage(language);
  };
  if (!field) {
    return (
      <HeaderLanguageSelect
        languages={LANGUAGES}
        value={i18n.language}
        onChange={choose}
        label={t('app.language')}
        nameOf={(language) => t(`languages.${language}`)}
      />
    );
  }
  return (
    <Select
      label={t('app.language')}
      value={i18n.language}
      onChange={(event) => choose(event.target.value)}
    >
      {LANGUAGES.map((language) => (
        <option key={language} value={language} lang={language}>
          {t(`languages.${language}`)}
        </option>
      ))}
    </Select>
  );
}
