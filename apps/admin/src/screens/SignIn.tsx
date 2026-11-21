import { Button, Field, OlympusScene, Send } from '@oikos/ui';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase';

/** `sessionEnded` : la session précédente a été fermée sur un refus de l'API (#565) ; l'écran dit pourquoi. */
export function SignIn({ sessionEnded = false }: { sessionEnded?: boolean }) {
  const { t } = useTranslation();
  const noticeId = useId();
  const emailId = useId();
  // Après une session fermée, le foyer va au champ : la page a changé sous l'utilisateur. Posé par un effet, car
  // l'avis peut arriver après l'écran (fermeture annoncée par Supabase Auth avant la nôtre).
  useEffect(() => {
    if (sessionEnded) document.getElementById(emailId)?.focus();
  }, [sessionEnded, emailId]);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setState(error ? 'failed' : 'sent');
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <CardHeading
        icon={<OlympusScene className="h-auto w-full" />}
        title={t('signIn.title')}
        wide
      />
      {sessionEnded && (
        <p id={noticeId} role="status" className="rounded-lg bg-info-subtle p-3 text-sm text-info">
          {t('signIn.sessionEnded')}
        </p>
      )}
      <p className="text-sm text-foreground-secondary">{t('signIn.intro')}</p>
      <Field
        label={t('signIn.email')}
        id={emailId}
        aria-describedby={sessionEnded ? noticeId : undefined}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button
        icon={<Send aria-hidden="true" />}
        type="submit"
        size="lg"
        loading={state === 'sending'}
      >
        {t('signIn.submit')}
      </Button>
      {state === 'sent' && (
        <p role="status" className="rounded-lg bg-success-subtle p-3 text-sm text-success">
          {t('signIn.sent', { email })}
        </p>
      )}
      {state === 'failed' && (
        <p role="alert" className="rounded-lg bg-danger-subtle p-3 text-sm text-danger">
          {t('signIn.failed')}
        </p>
      )}
    </form>
  );
}

/**
 * En-tête d'une carte de connexion : pictogramme dans un carré arrondi, ou illustration sur toute la largeur
 * (`wide`), puis le titre de la page.
 */
export function CardHeading({
  icon,
  title,
  wide = false,
}: {
  icon: ReactNode;
  title: string;
  wide?: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-4">
      <span
        aria-hidden="true"
        className={
          wide
            ? 'w-full'
            : 'grid size-11 place-items-center rounded-xl bg-primary-subtle text-primary [&_svg]:size-5.5'
        }
      >
        {icon}
      </span>
      <h1 className="text-[1.625rem] leading-tight font-bold">{title}</h1>
    </div>
  );
}
