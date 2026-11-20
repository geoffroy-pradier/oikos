import { adminModulesFor, type AdminModule, type AdminRole } from '@oikos/contracts';
import {
  Badge,
  Card,
  cn,
  Coins,
  Eye,
  Gavel,
  IconButton,
  KeyRound,
  Landmark,
  LogOut,
  Moon,
  ScrollText,
  Settings,
  ShieldAlert,
  Sparkles,
  type Icon,
} from '@oikos/ui';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assuranceLevel } from './aal';
import { adminGet } from './api';
import { LANGUAGES } from './i18n';
import { Access } from './screens/Access';
import { Audit } from './screens/Audit';
import { Config } from './screens/Config';
import { Economy } from './screens/Economy';
import { Events } from './screens/Events';
import { Moderation } from './screens/Moderation';
import { SecondFactor } from './screens/SecondFactor';
import { SignIn } from './screens/SignIn';
import { Vigie } from './screens/Vigie';
import { refusedToken, renewOrEnd, SESSION_ENDED_EVENT } from './session';
import { supabase } from './supabase';
import { applyTheme, shownTheme } from './theme';

/** Icône au trait de chaque module : décorative, le libellé porte l'information. */
const ICONS: Record<AdminModule, Icon> = {
  vigie: Eye,
  economy: Coins,
  config: Settings,
  audit: ScrollText,
  access: KeyRound,
  animation: Sparkles,
  moderation: Gavel,
};

export function App() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  /** Réponse de l'API pour un compte : son rôle (`null` : accès refusé) ou une panne. */
  const [access, setAccess] = useState<{
    userId: string;
    role: AdminRole | null;
    failed: boolean;
  } | null>(null);
  const [module, setModule] = useState<AdminModule>('vigie');
  /** Session fermée sur un refus de l'API (#565) : la connexion dit pourquoi, jusqu'à la suivante. */
  const [sessionEnded, setSessionEnded] = useState(false);
  /** Thème posé par `index.html` (choix mémorisé, sinon celui du système), basculé par l'en-tête. */
  const [theme, setTheme] = useState(shownTheme);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (!next) {
        setAccess(null);
      }
      if (event === 'SIGNED_IN') setSessionEnded(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // L'API refuse le jeton : la session est d'abord renouvelée (jeton expiré au réveil de l'appareil) ; refusée
  // par Supabase Auth (compte effacé), elle est fermée sur cet appareil et Olympe revient à la connexion. Un jeton
  // renouvelé que l'API refuse avant son expiration ferme la session : pas de boucle entre `me` et le renouvellement.
  useEffect(() => {
    const end = (event: Event) =>
      void renewOrEnd(supabase.auth, refusedToken(event)).then((outcome) => {
        if (outcome === 'ended') setSessionEnded(true);
      });
    window.addEventListener(SESSION_ENDED_EVENT, end);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, end);
  }, []);

  // Relit la session enregistrée (après le second facteur, Supabase Auth en a émis une nouvelle).
  const refresh = useCallback(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  const userId = session?.user.id;
  const sessionToken = session?.access_token;
  // Le niveau est lu dans le jeton de la session : il ne vaut que pour ce jeton, et l'API n'est
  // interrogée qu'avec un jeton à second facteur. Le rôle ne vaut que pour le compte qui l'a obtenu :
  // au changement de compte ou à la déconnexion, plus rien n'en reste.
  const level = sessionToken ? assuranceLevel(sessionToken) : null;
  const token = level === 'aal2' ? sessionToken : undefined;
  const mine = userId && access?.userId === userId ? access : null;

  // Session à second facteur : l'API dit si le compte a un rôle, et lequel.
  useEffect(() => {
    if (!token || !userId) return;
    let cancelled = false;
    void adminGet<{ role: AdminRole }>('me', token).then((reply) => {
      if (cancelled) return;
      const failed = !reply.ok && reply.code !== 'FORBIDDEN';
      // Une panne pendant l'usage (renouvellement de jeton) ne retire pas un rôle déjà lu.
      setAccess((known) =>
        failed && known?.userId === userId && known.role
          ? known
          : { userId, role: reply.ok ? reply.data.role : null, failed },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  // Rien de ce qui dépend du rôle n'est rendu sans session à second facteur.
  const answered = token && mine ? mine : null;
  const granted = answered && !answered.failed ? answered.role : undefined;
  // Navigation composée d'après la liste des rôles par module partagée avec l'API, qui fait foi.
  const modules = granted ? adminModulesFor(granted) : [];
  const current = modules.includes(module) ? module : modules[0];

  let screen = <p>{t('app.loading')}</p>;
  if (session === null) screen = <SignIn sessionEnded={sessionEnded} />;
  else if (session && level && level !== 'aal2') screen = <SecondFactor onVerified={refresh} />;
  else if (answered?.failed) screen = <p role="alert">{t('app.loadFailed')}</p>;
  else if (granted === null) {
    // Sans rôle : le compte lit son identifiant, à transmettre à un super-administrateur (15.3).
    screen = (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-full bg-danger-subtle text-danger ring-8 ring-danger-subtle/40 [&_svg]:size-7"
        >
          <ShieldAlert />
        </span>
        <p role="alert" className="text-xl font-semibold">
          {t('app.forbidden')}
        </p>
        <p className="text-muted-foreground">{t('app.forbiddenNext')}</p>
        <code className="rounded-md bg-muted px-2 py-1 text-sm break-all">{userId}</code>
      </div>
    );
  } else if (granted && token && userId) {
    screen =
      current === 'vigie' ? (
        <Vigie accessToken={token} />
      ) : current === 'economy' ? (
        <Economy accessToken={token} />
      ) : current === 'config' ? (
        <Config accessToken={token} role={granted} />
      ) : current === 'audit' ? (
        <Audit accessToken={token} />
      ) : current === 'access' ? (
        <Access accessToken={token} userId={userId} />
      ) : current === 'animation' ? (
        <Events accessToken={token} />
      ) : current === 'moderation' ? (
        <Moderation accessToken={token} />
      ) : (
        <p>{t('app.forbiddenModule')}</p>
      );
  }

  const shell = modules.length > 0;
  return (
    // À partir de 1 024 px, barre latérale des modules (ADR 0011) ; sa colonne garde son fond et sa bordure sur
    // toute la hauteur de la page. Avant l'ouverture d'un module, l'écran tient dans une carte centrée.
    <div
      className={cn(
        'min-h-dvh bg-background text-foreground',
        shell &&
          'lg:grid lg:grid-cols-[15rem_1fr] lg:bg-[linear-gradient(to_right,var(--surface)_calc(15rem-1px),var(--border-subtle)_calc(15rem-1px)_15rem,var(--background)_15rem)]',
      )}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-surface focus:p-3"
      >
        {t('app.skipToContent')}
      </a>
      {/* Un seul jeu de commandes : en haut sur téléphone, réparti dans la barre latérale sur ordinateur. */}
      <header
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-border-subtle bg-surface px-4 py-3',
          shell &&
            'lg:sticky lg:top-0 lg:h-dvh lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-6 lg:overflow-y-auto lg:border-b-0 lg:px-3.5 lg:py-5',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:flex-none lg:px-1.5">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background"
          >
            <Landmark className="size-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-lg leading-tight font-bold tracking-tight">{t('app.title')}</p>
            {!granted && <p className="text-xs text-muted-foreground">{t('app.subtitle')}</p>}
          </div>
        </div>
        {/* Rôle sur sa propre ligne : sous la marque dans la barre latérale, sous l'en-tête sur téléphone. */}
        {granted && (
          <p className="order-1 w-full lg:order-none lg:-mt-3 lg:px-1.5">
            <Badge>{t('app.role', { role: t(`roles.${granted}`) })}</Badge>
          </p>
        )}
        <div className="flex items-center gap-1 lg:order-3 lg:mt-auto">
          <label htmlFor="language" className="sr-only">
            {t('app.language')}
          </label>
          <select
            id="language"
            className="min-h-11 min-w-0 rounded-lg border border-border bg-surface-raised px-2 text-sm lg:flex-1"
            value={i18n.language}
            onChange={(event) => void i18n.changeLanguage(event.target.value)}
          >
            {LANGUAGES.map((language) => (
              <option key={language} value={language} lang={language}>
                {t(`languages.${language}`)}
              </option>
            ))}
          </select>
          <IconButton
            label={t('app.darkTheme')}
            icon={<Moon />}
            aria-pressed={theme === 'dark'}
            className="aria-pressed:bg-muted"
            onClick={() => toggleTheme()}
          />
          {session && (
            <IconButton
              label={t('app.signOut')}
              icon={<LogOut />}
              onClick={() => void supabase.auth.signOut()}
            />
          )}
        </div>
        {shell && (
          <nav aria-label={t('app.navigation')} className="order-2 w-full lg:order-2">
            {/* Pastilles qui défilent sur téléphone, liste verticale sur ordinateur. */}
            <ul className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:p-0">
              {modules.map((id) => {
                const ModuleIcon = ICONS[id];
                const here = id === current;
                return (
                  <li key={id} className="shrink-0">
                    <button
                      type="button"
                      aria-current={here ? 'page' : undefined}
                      onClick={() => setModule(id)}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-2 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-fast) ease-out',
                        'lg:min-h-11 lg:gap-3 lg:rounded-lg lg:px-3 lg:text-[0.9375rem] [&_svg]:size-4.5 [&_svg]:shrink-0',
                        here
                          ? 'bg-foreground text-background lg:bg-primary-subtle lg:font-semibold lg:text-primary'
                          : 'border border-border-subtle text-foreground-secondary hover:bg-muted hover:text-foreground lg:border-0',
                      )}
                    >
                      <ModuleIcon aria-hidden="true" strokeWidth={here ? 2.25 : 1.8} />
                      {t(`tabs.${id}`)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </header>
      <main
        id="main"
        tabIndex={-1}
        className={cn(
          'mx-auto w-full min-w-0',
          shell
            ? 'max-w-6xl p-4 lg:p-8'
            : 'flex min-h-[calc(100dvh-4.5rem)] max-w-md items-center p-4',
        )}
      >
        {shell ? (
          // Clé sur le module : chaque écran paraît par une courte montée (coupée sous reduced-motion).
          <div key={current} className="flex animate-rise flex-col gap-6">
            {screen}
          </div>
        ) : (
          <Card className="flex w-full animate-rise flex-col gap-4 p-6 sm:p-8">{screen}</Card>
        )}
      </main>
    </div>
  );
}
