import { adminModulesFor, type AdminModule, type AdminRole } from '@oikos/contracts';
import {
  Badge,
  Button,
  Card,
  Coins,
  Eye,
  Frieze,
  Gavel,
  KeyRound,
  Landmark,
  LogOut,
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
import { supabase } from './supabase';

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

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setAccess(null);
      }
    });
    return () => data.subscription.unsubscribe();
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
  if (session === null) screen = <SignIn />;
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
        <p role="alert" className="font-display text-xl font-semibold">
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

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-subtle bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-3xl font-semibold text-primary">
            <Landmark aria-hidden="true" className="size-7 shrink-0" />
            {t('app.title')}
          </p>
          {granted ? (
            <Badge tone="aegean" className="mt-1">
              {t('app.role', { role: t(`roles.${granted}`) })}
            </Badge>
          ) : (
            <p className="text-sm text-muted-foreground">{t('app.subtitle')}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="language" className="sr-only">
            {t('app.language')}
          </label>
          <select
            id="language"
            className="min-h-11 rounded-md border border-border bg-surface-raised px-2"
            value={i18n.language}
            onChange={(event) => void i18n.changeLanguage(event.target.value)}
          >
            {LANGUAGES.map((language) => (
              <option key={language} value={language} lang={language}>
                {t(`languages.${language}`)}
              </option>
            ))}
          </select>
          {session && (
            <Button
              variant="ghost"
              icon={<LogOut aria-hidden="true" />}
              onClick={() => void supabase.auth.signOut()}
            >
              {t('app.signOut')}
            </Button>
          )}
        </div>
      </header>
      <Frieze />
      <div className={modules.length > 0 ? 'lg:grid lg:grid-cols-[14rem_1fr]' : undefined}>
        {modules.length > 0 && (
          <nav
            aria-label={t('app.navigation')}
            className="px-4 pt-4 lg:sticky lg:top-0 lg:self-start lg:pr-0"
          >
            <ul className="-mx-1.5 flex gap-2 overflow-x-auto p-1.5 lg:mx-0 lg:flex-col lg:overflow-visible lg:p-0">
              {modules.map((id) => {
                const ModuleIcon = ICONS[id];
                return (
                  <li key={id} className="shrink-0">
                    <Button
                      variant={id === current ? 'primary' : 'secondary'}
                      className="lg:w-full lg:justify-start"
                      icon={<ModuleIcon aria-hidden="true" />}
                      aria-current={id === current ? 'page' : undefined}
                      onClick={() => setModule(id)}
                    >
                      {t(`tabs.${id}`)}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
        <main className={`mx-auto w-full min-w-0 p-4 ${granted ? 'max-w-5xl' : 'max-w-md'}`}>
          <Card elevation="raised" className="flex animate-rise flex-col gap-3">
            {screen}
          </Card>
        </main>
      </div>
    </div>
  );
}
