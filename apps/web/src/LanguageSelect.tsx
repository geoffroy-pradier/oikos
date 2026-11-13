import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language } from './i18n';
import { storeLanguage } from './preferences';

/** Choix de la langue, mémorisé. Présent sur tous les écrans, avant comme après la connexion. */
export function LanguageSelect() {
  const { t, i18n } = useTranslation();
  return (
    <>
      <label htmlFor="language" className="sr-only">
        {t('app.language')}
      </label>
      <select
        id="language"
        className="min-h-11 rounded-md border border-border bg-surface px-2"
        value={i18n.language}
        onChange={(event) => {
          const language = event.target.value as Language;
          storeLanguage(language);
          void i18n.changeLanguage(language);
        }}
      >
        {LANGUAGES.map((language) => (
          <option key={language} value={language} lang={language}>
            {t(`languages.${language}`)}
          </option>
        ))}
      </select>
    </>
  );
}
