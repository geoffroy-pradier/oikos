import { cn, House, Landmark, MapIcon, MessagesSquare, Store, type Icon } from '@oikos/ui';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyTheme, initialTheme, type Theme } from './preferences';
import { SanctionNotice } from './screens/SanctionNotice';
import { router, TABS, tabOf, type TabId } from './router';
import { ShellHeader } from './ShellHeader';
import { supabase } from './supabase';

/** Icônes au trait (direction artistique). Décoratives : le libellé de l'onglet porte l'information. */
const ICONS: Record<TabId, Icon> = {
  house: House,
  map: MapIcon,
  agora: Store,
  city: Landmark,
  messages: MessagesSquare,
};

export function Shell() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = tabOf(pathname);
  const [theme, setTheme] = useState<Theme>(() =>
    initialTheme(window.matchMedia('(prefers-color-scheme: dark)').matches),
  );

  // À la déconnexion, on revient à l'accueil : le compte suivant ne doit pas hériter de l'adresse en cours.
  function signOut() {
    void router.navigate({ to: '/' });
    void supabase.auth.signOut();
  }

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }

  return (
    <div className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-surface focus:p-3"
      >
        {t('shell.skipToContent')}
      </a>

      {/* Barre d'onglets en bas sur téléphone, barre latérale sur ordinateur. Police agrandie : les libellés
          passent à la ligne plutôt que de se chevaucher ou d'être coupés. */}
      <nav
        aria-label={t('shell.navigation')}
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border-subtle bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-lg backdrop-blur lg:sticky lg:inset-x-auto lg:top-0 lg:h-dvh lg:border-t-0 lg:border-r lg:pb-0 lg:shadow-none"
      >
        <p className="hidden items-center gap-2 p-4 text-2xl font-semibold text-primary lg:flex">
          <Landmark aria-hidden="true" className="size-6" />
          {t('app.title')}
        </p>
        <ul className="grid grid-cols-5 lg:flex lg:flex-col lg:gap-1 lg:p-3">
          {TABS.map((tab) => {
            const Icon = ICONS[tab.id];
            const current = tab.id === active;
            return (
              <li key={tab.id} className="min-w-0">
                <Link
                  to={tab.to}
                  // L'onglet actif se déduit du chemin : un écran de l'onglet Maison (`/comptes`) le
                  // garde marqué, ce que la correspondance de route seule ne ferait pas.
                  className={cn(
                    'group relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-xs leading-tight wrap-anywhere transition-colors duration-(--motion-fast) ease-out hover:text-primary lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-md lg:px-3 lg:text-left lg:text-base lg:hover:bg-muted',
                    current
                      ? 'font-bold text-primary lg:bg-primary-subtle'
                      : 'text-muted-foreground',
                  )}
                  aria-current={current ? 'page' : undefined}
                  // Garde-fou : le routeur force `aria-current` sur un lien qui correspond ; en
                  // correspondance exacte, c'est toujours l'onglet que `tabOf` a choisi.
                  activeOptions={{ exact: true, includeSearch: false }}
                >
                  {/* Téléphone : trait en haut de l'onglet actif, en plus de la couleur et du gras. */}
                  {current && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary lg:hidden"
                    />
                  )}
                  <Icon aria-hidden="true" className="size-6" strokeWidth={current ? 2.25 : 1.75} />
                  <span>{t(`tabs.${tab.id}.label`)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 pb-20 lg:pb-0">
        <ShellHeader dark={theme === 'dark'} onToggleTheme={toggleTheme} onSignOut={signOut} />
        {/* Clé sur le chemin : chaque écran paraît par une courte montée (coupée sous reduced-motion). */}
        <main id="main" tabIndex={-1} className="mx-auto max-w-5xl p-4 lg:p-8">
          <div key={pathname} className="animate-rise">
            <SanctionNotice />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
