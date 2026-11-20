import { Button, KeyRound } from '@oikos/ui';
import { CONTROL } from '../ui';
import { CardHeading } from './SignIn';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabase';

interface Factor {
  id: string;
  /** Présents à l'enrôlement seulement : code QR (image) et clé à saisir à la main. */
  qrCode?: string;
  secret?: string;
}

/**
 * Cause d'un code non validé, d'après l'erreur du client Supabase Auth (`@supabase/auth-js`, `lib/fetch.ts`) :
 * - sans réponse : `AuthRetryableFetchError` de statut 0 ;
 * - service en panne : la même erreur avec son statut 5xx, ou `AuthUnknownError`, sans statut ;
 * - trop de tentatives : `AuthApiError` 429 ; code refusé : toute autre `AuthApiError` 4xx.
 * Seul le dernier cas met le code saisi en cause.
 */
export function verifyFailure(error: { status?: number | undefined }) {
  if (error.status === 0) return 'network' as const;
  if (error.status === 429) return 'rateLimited' as const;
  return error.status === undefined || error.status >= 500
    ? ('failed' as const)
    : ('invalid' as const);
}

/**
 * Second facteur (TOTP), obligatoire pour le back-office (docs/specs/15-back-office-olympe.md, 15.4).
 * Premier passage : enrôlement d'une application d'authentification. Ensuite : saisie du code.
 */
export function SecondFactor({ onVerified }: { onVerified: () => void }) {
  const { t } = useTranslation();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<'invalid' | 'network' | 'rateLimited' | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  // Lit les facteurs du compte et, au premier passage, en enrôle un. Relancé par « Réessayer ».
  const start = useCallback(async () => {
    setError(null);
    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) return setError('failed');
    const verified = factors.data.totp[0];
    if (verified) return setFactor({ id: verified.id });
    // Un enrôlement abandonné laisse un facteur non vérifié : on repart d'un facteur neuf.
    for (const stale of factors.data.all.filter((entry) => entry.status === 'unverified')) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
    const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (enrolled.error) return setError('failed');
    setFactor({
      id: enrolled.data.id,
      qrCode: enrolled.data.totp.qr_code,
      secret: enrolled.data.totp.secret,
    });
  }, []);
  useEffect(() => {
    // Un seul enrôlement, même si l'effet est rejoué (mode strict de React).
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!factor) return;
    setBusy(true);
    setError(null);
    const result = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: code.replace(/\s/g, ''),
    });
    setBusy(false);
    if (result.error) return setError(verifyFailure(result.error));
    onVerified();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <CardHeading icon={<KeyRound />} title={t('mfa.title')} />
      {factor?.secret ? (
        <>
          <p className="text-sm text-foreground-secondary">{t('mfa.enrollIntro')}</p>
          {/* Fond blanc dans les deux thèmes : un code QR se lit en sombre sur clair. */}
          {factor.qrCode && (
            <img
              src={factor.qrCode}
              alt={t('mfa.qrAlt')}
              className="size-44 self-center rounded-xl border border-border-subtle bg-white p-2"
            />
          )}
          <p className="rounded-lg bg-surface-raised p-3 text-sm">
            {t('mfa.secret')} : <code className="font-semibold break-all">{factor.secret}</code>
          </p>
        </>
      ) : (
        <p className="text-sm text-foreground-secondary">
          {factor ? t('mfa.verifyIntro') : t('app.loading')}
        </p>
      )}
      <label htmlFor="code" className="-mb-2 text-sm font-medium">
        {t('mfa.code')}
      </label>
      <input
        id="code"
        className={`${CONTROL} text-lg tracking-[0.2em] tabular-nums`}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-describedby="code-error"
        aria-invalid={error === 'invalid'}
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      <p id="code-error" role="alert" className="-mt-2 text-sm font-semibold text-danger">
        {error && t(`mfa.${error}`)}
      </p>
      {!factor && error === 'failed' && (
        <Button variant="secondary" onClick={() => void start()}>
          {t('app.retry')}
        </Button>
      )}
      <Button type="submit" size="lg" disabled={busy || !factor || code.trim() === ''}>
        {t('mfa.submit')}
      </Button>
    </form>
  );
}
