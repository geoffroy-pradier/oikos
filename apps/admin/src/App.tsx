import type { AdminRole } from '@oikos/contracts';
import { Button, Card } from '@oikos/ui';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminGet } from './api';
import { LANGUAGES } from './i18n';
import { Audit } from './screens/Audit';
import { SecondFactor } from './screens/SecondFactor';
import { SignIn } from './screens/SignIn';
import { Vigie } from './screens/Vigie';
import { supabase } from './supabase';

/** Modules ouverts à chaque rôle (docs/specs/15-back-office-olympe.md, 15.3). L'API fait foi. */
const MODULES = {
  vigie: ['super_admin', 'game_designer', 'observer'],
  audit: ['super_admin', 'observer'],
} as const satisfies Record<string, readonly AdminRole[]>;
type Module = keyof typeof MODULES;
const MODULE_IDS = Object.keys(MODULES) as Module[];

export function modulesFor(role: AdminRole): Module[] {
  return MODULE_IDS.filter((id) => MODULES[id].some((allowed) => allowed === role));
}

export function App() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  /** Niveau d'assurance constaté pour un jeton donné : le back-office exige `aal2`. */
  const [assurance, setAssurance] = useState<{
    userId: string;
    token: string;
    level: string;
  } | null>(null);
  /** Réponse de l'API pour un compte : son rôle (`null` : accès refusé) ou une panne. */
  const [access, setAccess] = useState<{
    userId: string;
    role: AdminRole | null;
    failed: boolean;
  } | null>(null);
  const [module, setModule] = useState<Module>('vigie');

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setAssurance(null);
        setAccess(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const sessionToken = session?.access_token;
  // Jeton courant : une réponse arrivée pour un jeton qui n'est plus celui-là est ignorée.
  const currentToken = useRef(sessionToken);
  currentToken.current = sessionToken;

  const check = useCallback(async () => {
    if (!sessionToken || !userId) return;
    const reply = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (currentToken.current !== sessionToken) return;
    setAssurance({ userId, token: sessionToken, level: reply.data?.currentLevel ?? 'aal1' });
  }, [sessionToken, userId]);
  useEffect(() => {
    void check();
  }, [check]);

  // Niveau et rôle ne valent que pour le compte qui les a obtenus : au changement de compte ou à la
  // déconnexion, plus rien n'en reste. Un renouvellement de jeton du même compte garde l'écran en
  // cours, servi par le dernier jeton dont le second facteur a été constaté.
  const level = userId && assurance?.userId === userId ? assurance.level : null;
  const token = level === 'aal2' ? assurance?.token : undefined;
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
  const modules = granted ? modulesFor(granted) : [];
  const current = modules.includes(module) ? module : modules[0];

  let screen = <p>{t('app.loading')}</p>;
  if (session === null) screen = <SignIn />;
  else if (session && level && level !== 'aal2')
    screen = <SecondFactor onVerified={() => void check()} />;
  else if (answered?.failed) screen = <p role="alert">{t('app.loadFailed')}</p>;
  else if (granted === null) screen = <p role="alert">{t('app.forbidden')}</p>;
  else if (granted && token) {
    screen =
      current === 'vigie' ? (
        <Vigie accessToken={token} />
      ) : current === 'audit' ? (
        <Audit accessToken={token} />
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
