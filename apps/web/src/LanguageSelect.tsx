import { Select } from '@oikos/ui';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language } from './i18n';
import { storeLanguage } from './preferences';

/**
 * Choix de la langue, mémorisé : avant la connexion dans l'en-tête, libellé réservé aux lecteurs d'écran ;
 * dans les Réglages (`field`), en champ libellé.
 */
export function LanguageSelect({ field = false }: { field?: boolean }) {
  const { t, i18n } = useTranslation();
  const choose = (event: ChangeEvent<HTMLSelectElement>) => {
    const language = event.target.value as Language;
    storeLanguage(language);
    void i18n.changeLanguage(language);
  };
  const options = LANGUAGES.map((language) => (
    <option key={language} value={language} lang={language}>
      {t(`languages.${language}`)}
    </option>
  ));
  if (field) {
    return (
      <Select label={t('app.language')} value={i18n.language} onChange={choose}>
        {options}
      </Select>
    );
  }
  return (
    <>
      <label htmlFor="language" className="sr-only">
        {t('app.language')}
      </label>
      <select
        id="language"
        className="min-h-11 rounded-md border border-border bg-surface px-2"
        value={i18n.language}
        onChange={choose}
      >
        {options}
      </select>
    </>
  );
}
