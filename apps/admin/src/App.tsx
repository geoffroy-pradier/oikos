import type { AdminRole } from '@oikos/contracts';
import { Button, Card } from '@oikos/ui';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
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

export function App() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  /** Niveau d'assurance de la session : le back-office exige `aal2`. */
  const [level, setLevel] = useState<string | null>(null);
  /** Rôle du compte ; `null` : accès refusé par l'API. */
  const [role, setRole] = useState<AdminRole | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [module, setModule] = useState<Module>('vigie');

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const token = session?.access_token;
  const check = useCallback(async () => {
    if (!token) return;
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setLevel(assurance.data?.currentLevel ?? 'aal1');
  }, [token]);
  useEffect(() => {
    setLevel(null);
    setRole(undefined);
    void check();
  }, [check]);

  // Session à second facteur : l'API dit si le compte a un rôle, et lequel.
  useEffect(() => {
    if (!token || level !== 'aal2') return;
    void adminGet<{ role: AdminRole }>('me', token).then((reply) => {
      setFailed(!reply.ok && reply.code !== 'FORBIDDEN');
      setRole(reply.ok ? reply.data.role : reply.code === 'FORBIDDEN' ? null : undefined);
    });
  }, [token, level]);

  const modules = role
    ? MODULE_IDS.filter((id) => MODULES[id].some((allowed) => allowed === role))
    : [];
  const current = modules.includes(module) ? module : modules[0];

  let screen = <p>{t('app.loading')}</p>;
  if (session === null) screen = <SignIn />;
  else if (session && level && level !== 'aal2')
    screen = <SecondFactor onVerified={() => void check()} />;
  else if (failed) screen = <p role="alert">{t('app.loadFailed')}</p>;
  else if (role === null) screen = <p role="alert">{t('app.forbidden')}</p>;
  else if (role && token) {
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
            {role ? t('app.role', { role: t(`roles.${role}`) }) : t('app.subtitle')}
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
      <main className={`mx-auto p-4 ${role ? 'max-w-5xl' : 'max-w-md'}`}>
        <Card className="flex flex-col gap-3">{screen}</Card>
      </main>
    </div>
  );
}
