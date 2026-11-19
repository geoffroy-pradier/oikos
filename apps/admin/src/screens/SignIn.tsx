import { Button, Field } from '@oikos/ui';
import { useEffect, useId, useState, type FormEvent } from 'react';
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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h1 className="text-2xl">{t('signIn.title')}</h1>
      {sessionEnded && (
        <p id={noticeId} role="status" className="rounded-md bg-muted p-3">
          {t('signIn.sessionEnded')}
        </p>
      )}
      <p>{t('signIn.intro')}</p>
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
      <Button type="submit" disabled={state === 'sending'}>
        {t('signIn.submit')}
      </Button>
      {state === 'sent' && <p role="status">{t('signIn.sent', { email })}</p>}
      {state === 'failed' && <p role="alert">{t('signIn.failed')}</p>}
    </form>
  );
}
