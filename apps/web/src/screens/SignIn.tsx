import { Button, Card, TextField, WelcomeScene } from '@oikos/ui';
import { useId, useLayoutEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase';

/** `sessionEnded` : la session précédente a été fermée sur un refus de l'API (#565) ; l'écran dit pourquoi. */
export function SignIn({ sessionEnded = false }: { sessionEnded?: boolean }) {
  const { t } = useTranslation();
  const noticeId = useId();
  const emailId = useId();
  // Après une session fermée, le foyer va au champ : la page a changé sous l'utilisateur. Posé par un effet, car
  // l'avis peut arriver après l'écran (fermeture annoncée par Supabase Auth avant la nôtre). Effet de mise en page :
  // le foyer est posé dans le même rendu que l'écran, jamais un instant après (un effet passif pouvait courir après
  // l'apparition de l'écran quand le rendu partait d'une promesse hors `act`).
  useLayoutEffect(() => {
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

  // Téléphone : la scène au-dessus de la carte ; ordinateur : à côté, la carte centrée sur la scène.
  return (
    <div className="mx-auto grid max-w-4xl items-center gap-6 md:grid-cols-2 md:gap-12">
      <div className="flex flex-col gap-3">
        <WelcomeScene className="h-auto w-full rounded-xl" />
        <p className="text-center text-foreground-secondary">{t('signIn.welcome')}</p>
      </div>
      <Card elevation="raised" className="p-5 md:p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h1 className="text-2xl">{t('signIn.title')}</h1>
          {sessionEnded && (
            <p id={noticeId} role="status" className="rounded-md bg-muted/40 p-3">
              {t('signIn.sessionEnded')}
            </p>
          )}
          <p className="text-muted-foreground">{t('signIn.intro')}</p>
          <TextField
            label={t('signIn.email')}
            id={emailId}
            aria-describedby={sessionEnded ? noticeId : undefined}
            error={state === 'failed' ? t('signIn.failed') : undefined}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button type="submit" size="lg" loading={state === 'sending'}>
            {t('signIn.submit')}
          </Button>
          {state === 'sent' && <p role="status">{t('signIn.sent', { email })}</p>}
        </form>
      </Card>
    </div>
  );
}
