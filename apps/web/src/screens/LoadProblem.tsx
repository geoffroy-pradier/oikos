import { Button } from '@oikos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Lecture en échec : le dire, et proposer de relire. `onRetry` relit ce qui a échoué ; le bouton reste
 * inactif le temps de la relecture, pour qu'un double appui ne la lance pas deux fois.
 */
export function LoadProblem({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="alert">{t('app.loadFailed')}</p>
      <Button
        variant="secondary"
        aria-disabled={retrying}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        onClick={() => {
          if (retrying) return;
          setRetrying(true);
          void onRetry().finally(() => setRetrying(false));
        }}
      >
        {t('app.retry')}
      </Button>
    </div>
  );
}

/** Lecture en cours : un texte discret, sans rôle d'annonce (les résultats d'action gardent `status`). */
export function Loading() {
  const { t } = useTranslation();
  return <p className="text-muted-foreground">{t('app.loading')}</p>;
}
