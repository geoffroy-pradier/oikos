import { Button, Skeleton } from '@oikos/ui';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Lecture en échec : le dire, et proposer de relire. `onRetry` relit ce qui a échoué ; le bouton reste
 * inactif le temps de la relecture, pour qu'un double appui ne la lance pas deux fois.
 * Relecture réussie : le message disparaît avec son bouton, et le foyer va au titre `heading` de la
 * carte (il ne retombe pas sur la page). Relecture encore en échec : le message est annoncé de nouveau.
 */
export function LoadProblem({
  onRetry,
  heading,
}: {
  onRetry: () => Promise<unknown>;
  heading?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  // Chaque échec d'une relecture remonte le message : une alerte nouvelle est annoncée, une alerte
  // dont le texte ne change pas ne l'est pas.
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const retried = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Démonté après un « Réessayer » : la lecture a abouti. Le foyer était sur le bouton disparu.
      const target = heading?.current;
      if (retried.current && target && document.activeElement === document.body) target.focus();
    };
  }, [heading]);
  // Un essai qui a échoué n'est plus en cours : si le message disparaît plus tard par un autre chemin
  // (une action qui relit tout), le foyer n'est pas déplacé.
  useEffect(() => {
    retried.current = false;
  }, [attempt]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p key={attempt} role="alert">
        {t('app.loadFailed')}
      </p>
      <Button
        variant="secondary"
        aria-disabled={retrying}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        onClick={() => {
          if (retrying) return;
          retried.current = true;
          setRetrying(true);
          void onRetry().finally(() => {
            if (!mounted.current) return;
            setRetrying(false);
            setAttempt((n) => n + 1);
          });
        }}
      >
        {t('app.retry')}
      </Button>
    </div>
  );
}

/**
 * Lecture en cours : des formes de chargement, le texte réservé aux lecteurs d'écran, sans rôle d'annonce
 * (les résultats d'action gardent `status`).
 */
export function Loading() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <span className="sr-only">{t('app.loading')}</span>
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
    </div>
  );
}
