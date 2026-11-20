import {
  Button,
  cn,
  House,
  Landmark,
  MapIcon,
  MessagesSquare,
  Settings,
  Store,
  type Icon,
} from '@oikos/ui';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnreadTotal } from './chat-unread';
import { chooseTheme, storedThemeChoice, type ThemeChoice } from './preferences';
import { SanctionNotice } from './screens/SanctionNotice';
import { router, TABS, tabOf, type TabId } from './router';
import { SettingsSheet } from './SettingsSheet';
import { CompactHeader, HouseCard } from './ShellHouse';
import { supabase } from './supabase';

/** Icônes au trait (direction artistique). Décoratives : le libellé de l'onglet porte l'information. */
const ICONS: Record<TabId, Icon> = {
  house: House,
  map: MapIcon,
  agora: Store,
  city: Landmark,
  messages: MessagesSquare,
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Coquille du jeu (ADR 0011) : à partir de 1 024 px, barre latérale (marque, carte de la maison, onglets,
 * Réglages) ; en dessous, en-tête compact en haut et barre d'onglets en bas. Un seul élément `nav` change de
 * forme selon la largeur ; les parties propres à une mise en page sont masquées dans l'autre.
 */
export function Shell() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = tabOf(pathname);
  const [theme, setTheme] = useState<ThemeChoice>(storedThemeChoice);
  const [settings, setSettings] = useState(false);
  const unread = useUnreadTotal(pathname);

  // Thème de l'appareil : suivi en direct tant que c'est le choix du joueur.
  useEffect(() => {
    if (theme !== 'system') return;
    const query = window.matchMedia(DARK_QUERY);
    const follow = () => chooseTheme('system', query.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [theme]);

  function choose(next: ThemeChoice) {
    chooseTheme(next, window.matchMedia(DARK_QUERY).matches);
    setTheme(next);
  }

  // À la déconnexion, on revient à l'accueil : le compte suivant ne doit pas hériter de l'adresse en cours.
  function signOut() {
    void router.navigate({ to: '/' });
    void supabase.auth.signOut();
  }

  return (
    // La barre latérale colle à la fenêtre, à sa hauteur ; sa colonne garde son fond et sa bordure sur toute la
    // hauteur de la page (fin de page, capture pleine page).
    <div className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[15rem_1fr] lg:bg-[linear-gradient(to_right,var(--surface)_calc(15rem-1px),var(--border-subtle)_calc(15rem-1px)_15rem,var(--background)_15rem)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-surface focus:p-3"
      >
        {t('shell.skipToContent')}
      </a>

      <CompactHeader settingsOpen={settings} onSettings={() => setSettings(true)} />

      {/* Barre d'onglets en bas sur téléphone, barre latérale sur ordinateur. Police agrandie : les libellés
          passent à la ligne plutôt que de se chevaucher ou d'être coupés. */}
      <nav
        aria-label={t('shell.navigation')}
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border-subtle bg-surface pb-[env(safe-area-inset-bottom)] lg:sticky lg:inset-x-auto lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-5 lg:overflow-y-auto lg:border-t-0 lg:border-r lg:p-4"
      >
        <p className="hidden items-center gap-2.5 px-1 pt-1 text-lg font-bold tracking-tight lg:flex">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"
          >
            <House className="size-5" strokeWidth={2} />
          </span>
          {t('app.title')}
        </p>
        <div className="hidden lg:block">
          <HouseCard />
        </div>
        <ul className="grid grid-cols-5 lg:flex lg:flex-col lg:gap-1">
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
                    'relative flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 text-center text-[0.6875rem] leading-tight font-medium wrap-anywhere transition-colors duration-(--motion-fast) ease-out',
                    'lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-lg lg:px-3 lg:text-left lg:text-[0.9375rem]',
                    current
                      ? 'text-primary lg:bg-surface-raised lg:font-semibold lg:text-foreground'
                      : 'text-muted-foreground hover:text-foreground lg:hover:bg-muted',
                  )}
                  aria-current={current ? 'page' : undefined}
                  // Garde-fou : le routeur force `aria-current` sur un lien qui correspond ; en
                  // correspondance exacte, c'est toujours l'onglet que `tabOf` a choisi.
                  activeOptions={{ exact: true, includeSearch: false }}
                >
                  {/* Téléphone : trait en haut de l'onglet actif, en plus de la couleur. */}
                  {current && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary lg:hidden"
                    />
                  )}
                  <Icon
                    aria-hidden="true"
                    className={cn('size-6 shrink-0 lg:size-5', current && 'text-primary')}
                    strokeWidth={current ? 2.25 : 1.75}
                  />
                  <span>{t(`tabs.${tab.id}.label`)}</span>
                  {tab.id === 'messages' && unread && unread.count > 0 && (
                    <>
                      {/* Téléphone : un point contre l'icône, en pixels pour ne pas déborder sous une police
                          agrandie ; ordinateur : le nombre, en bout de ligne. */}
                      <span
                        aria-hidden="true"
                        className="absolute top-2 left-[calc(50%+8px)] size-2.5 rounded-full bg-primary lg:hidden"
                      />
                      <span
                        aria-hidden="true"
                        className="hidden min-w-5 rounded-full bg-primary px-1.5 text-center text-[0.6875rem] leading-5 font-semibold text-primary-foreground tabular-nums lg:ml-auto lg:inline-block"
                      >
                        {unread.count > 99 ? '99+' : `${unread.count}${unread.atLeast ? '+' : ''}`}
                      </span>
                      {/* Virgule : le nom de l'onglet et le compte ne se collent pas à la lecture. */}
                      <span className="sr-only">
                        {', '}
                        {t(unread.atLeast ? 'messages.unreadAtLeast' : 'messages.unread', {
                          count: unread.count,
                        })}
                      </span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="hidden lg:mt-auto lg:block">
          <Button
            variant="ghost"
            icon={<Settings aria-hidden="true" />}
            aria-haspopup="dialog"
            aria-expanded={settings}
            onClick={() => setSettings(true)}
            className="w-full justify-start px-3 text-muted-foreground enabled:hover:text-foreground"
          >
            {t('shell.settings')}
          </Button>
        </div>
      </nav>

      <div className="min-w-0 pb-20 lg:pb-0">
        {/* Clé sur le chemin : chaque écran paraît par une courte montée (coupée sous reduced-motion). */}
        <main id="main" tabIndex={-1} className="mx-auto max-w-5xl p-4 lg:p-8">
          <div key={pathname} className="animate-rise">
            <SanctionNotice />
            <Outlet />
          </div>
        </main>
      </div>

      <SettingsSheet
        open={settings}
        onClose={() => setSettings(false)}
        theme={theme}
        onTheme={choose}
        onSignOut={signOut}
      />
    </div>
  );
}
