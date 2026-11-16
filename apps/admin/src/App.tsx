import { adminModulesFor, type AdminModule, type AdminRole } from '@oikos/contracts';
import { Button, Card } from '@oikos/ui';
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
import { SecondFactor } from './screens/SecondFactor';
import { SignIn } from './screens/SignIn';
import { Vigie } from './screens/Vigie';
import { supabase } from './supabase';

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
      <>
        <p role="alert">{t('app.forbidden')}</p>
        <p>{t('app.forbiddenNext')}</p>
        <code className="break-all">{userId}</code>
      </>
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
      ) : (
        <p>{t('app.forbiddenModule')}</p>
      );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2 p-4">
        <div>
          <p className="font-display text-3xl font-semibold text-primary">{t('app.title')}</p>
          <p className="text-sm text-muted-foreground">
            {granted ? t('app.role', { role: t(`roles.${granted}`) }) : t('app.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="language" className="sr-only">
            {t('app.language')}
          </label>
          <select
            id="language"
            className="min-h-11 rounded-md border border-border bg-surface px-2"
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
            <Button variant="ghost" onClick={() => void supabase.auth.signOut()}>
              {t('app.signOut')}
            </Button>
          )}
        </div>
      </header>
      <div className="meander" aria-hidden="true" />
      {modules.length > 0 && (
        <nav aria-label={t('app.navigation')} className="flex flex-wrap gap-2 px-4 pt-4">
          {modules.map((id) => (
            <Button
              key={id}
              variant={id === current ? 'primary' : 'secondary'}
              aria-current={id === current ? 'page' : undefined}
              onClick={() => setModule(id)}
            >
              {t(`tabs.${id}`)}
            </Button>
          ))}
        </nav>
      )}
      <main className={`mx-auto p-4 ${granted ? 'max-w-5xl' : 'max-w-md'}`}>
        <Card className="flex flex-col gap-3">{screen}</Card>
      </main>
    </div>
  );
}
