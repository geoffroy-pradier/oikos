import { Button } from '@oikos/ui';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Bandeau qui propose une nouvelle version du client quand le service worker en a une prête.
 * Rien ne se recharge sans le joueur : il choisit le moment, une saisie en cours reste à l'écran.
 */
export function UpdateBanner({ onUpdate, onLater }: { onUpdate: () => void; onLater: () => void }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('app.update.title')}
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 border-b border-border bg-surface p-3"
    >
      <p className="min-w-0 flex-1">{t('app.update.ready')}</p>
      <Button onClick={onUpdate}>{t('app.update.now')}</Button>
      <Button variant="ghost" onClick={onLater}>
        {t('app.update.later')}
      </Button>
    </section>
  );
}

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <UpdateBanner
      onUpdate={() => void updateServiceWorker(true)}
      onLater={() => setNeedRefresh(false)}
    />
  );
}
