import { Button } from '@oikos/ui';
import { useTranslation } from 'react-i18next';

/** Message propre à chaque cause d'échec d'une lecture ; les autres codes sont une panne. */
const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'app.forbiddenModule',
  NETWORK: 'app.errors.network',
  RATE_LIMITED: 'app.errors.rateLimited',
};

/** Échec d'une lecture du back-office : sa cause, et de quoi la relancer (sauf un refus de rôle, définitif). */
export function LoadError({ code, onRetry }: { code: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="alert">{t(MESSAGES[code] ?? 'app.loadFailed')}</p>
      {code !== 'FORBIDDEN' && (
        <Button variant="secondary" onClick={onRetry}>
          {t('app.retry')}
        </Button>
      )}
    </div>
  );
}
