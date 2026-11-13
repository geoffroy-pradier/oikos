import { Button, Field } from '@oikos/ui';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase';

export function SignIn() {
  const { t } = useTranslation();
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
      <p>{t('signIn.intro')}</p>
      <Field
        label={t('signIn.email')}
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
