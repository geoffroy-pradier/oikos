import { Button, CircleAlert, ShieldAlert } from '@oikos/ui';
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
  const Glyph = code === 'FORBIDDEN' ? ShieldAlert : CircleAlert;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger-subtle p-3 text-danger">
      <Glyph aria-hidden="true" className="size-5 shrink-0" />
      <p role="alert" className="min-w-0 flex-1 basis-48 font-medium">
        {t(MESSAGES[code] ?? 'app.loadFailed')}
      </p>
      {code !== 'FORBIDDEN' && (
        <Button variant="secondary" onClick={onRetry}>
          {t('app.retry')}
        </Button>
      )}
    </div>
  );
}
