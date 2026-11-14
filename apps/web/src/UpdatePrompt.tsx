import { Button } from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { createUpdateController } from './update-controller';

/** Contenu du bandeau : la nouvelle version, et le choix du moment. */
export function UpdateBanner({ onUpdate, onLater }: { onUpdate: () => void; onLater: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface p-3">
      <p className="min-w-0 flex-1">{t('app.update.ready')}</p>
      <Button onClick={onUpdate}>{t('app.update.now')}</Button>
      <Button variant="ghost" onClick={onLater}>
        {t('app.update.later')}
      </Button>
    </div>
  );
}

/**
 * Propose une nouvelle version du client quand le service worker en a une. Rien ne se recharge sans
 * le joueur : il choisit le moment, une saisie en cours reste à l'écran. Monté une seule fois, au-dessus
 * de l'application ; la région reste dans la page pour que son contenu soit annoncé quand il paraît.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const controller = useRef<ReturnType<typeof createUpdateController> | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ onNeedReload: () => controller.current?.onNeedReload() });
  controller.current ??= createUpdateController({
    reload: () => window.location.reload(),
    offer: () => setNeedRefresh(true),
  });
  return (
    <section aria-label={t('app.update.title')} aria-live="polite">
      {needRefresh && (
        <UpdateBanner
          onUpdate={() => controller.current?.update(() => void updateServiceWorker(true))}
          onLater={() => setNeedRefresh(false)}
        />
      )}
    </section>
  );
}
