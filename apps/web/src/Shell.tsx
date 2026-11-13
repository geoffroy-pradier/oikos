import { Button } from '@oikos/ui';
import { Link, Outlet } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language } from './i18n';
import { applyTheme, initialTheme, storeLanguage, type Theme } from './preferences';
import { TABS, type TabId } from './router';
import { supabase } from './supabase';

/** Icônes au trait (direction artistique). Décoratives : le libellé de l'onglet porte l'information. */
const ICON_PATHS: Record<TabId, string> = {
  house: 'M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  agora: 'M3 9h18M5 9v9m4.5-9v9m5-9v9M19 9v9M3 18h18M12 3l9 4H3l9-4Z',
  city: 'M4 20V10l8-6 8 6v10M4 20h16M9 20v-5h6v5',
  messages: 'M4 5h16v11H9l-5 4V5Z',
};

function TabIcon({ tab }: { tab: TabId }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[tab]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Shell() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() =>
    initialTheme(window.matchMedia('(prefers-color-scheme: dark)').matches),
  );

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }

  function changeLanguage(language: Language) {
    storeLanguage(language);
    void i18n.changeLanguage(language);
  }

  return (
    <div className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-surface focus:p-3"
      >
        {t('shell.skipToContent')}
      </a>

      {/* Barre d'onglets en bas sur téléphone, barre latérale sur ordinateur. */}
      <nav
        aria-label={t('shell.navigation')}
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface lg:static lg:border-t-0 lg:border-r"
      >
        <p className="hidden p-4 font-display text-2xl font-semibold text-primary lg:block">
          {t('app.title')}
        </p>
        <ul className="grid grid-cols-5 lg:flex lg:flex-col lg:gap-1 lg:p-2">
          {TABS.map((tab) => (
            <li key={tab.id}>
              <Link
                to={tab.to}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md text-xs lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-base"
                activeProps={{ className: 'font-bold text-primary underline underline-offset-4' }}
                activeOptions={{ exact: true }}
              >
                <TabIcon tab={tab.id} />
                <span>{t(`tabs.${tab.id}.label`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 pb-16 lg:pb-0">
        <header className="flex flex-wrap items-center justify-end gap-2 p-2">
          <label htmlFor="language" className="sr-only">
            {t('app.language')}
          </label>
          <select
            id="language"
            className="min-h-11 rounded-md border border-border bg-surface px-2"
            value={i18n.language}
            onChange={(event) => changeLanguage(event.target.value as Language)}
          >
            {LANGUAGES.map((language) => (
              <option key={language} value={language} lang={language}>
                {t(`languages.${language}`)}
              </option>
            ))}
          </select>
          <Button variant="secondary" aria-pressed={theme === 'dark'} onClick={toggleTheme}>
            {t('shell.darkTheme')}
          </Button>
          <Button variant="ghost" onClick={() => void supabase.auth.signOut()}>
            {t('app.signOut')}
          </Button>
        </header>
        <div className="meander" aria-hidden="true" />
        <main id="main" tabIndex={-1} className="mx-auto max-w-5xl p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
