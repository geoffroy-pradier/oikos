import { Button } from '@oikos/ui';
import { CLIENT_SETTINGS } from '@oikos/config/client';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { scheduleUpdateChecks } from './update-checks';
import { createUpdateController } from './update-controller';

/** Contenu du bandeau : la nouvelle version, et le choix du moment. */
export function UpdateBanner({ onUpdate, onLater }: { onUpdate: () => void; onLater: () => void }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('app.update.title')}
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

/**
 * Propose une nouvelle version du client quand le service worker en a une. Rien ne se recharge sans
 * le joueur : il choisit le moment, une saisie en cours reste à l'écran. Monté une seule fois, au-dessus
 * de l'application ; la zone d'annonce reste dans la page pour que son contenu soit annoncé quand il paraît.
 */
export function UpdatePrompt() {
  const controller = useRef<ReturnType<typeof createUpdateController> | null>(null);
  const stopChecks = useRef<(() => void) | null>(null);
  const unmounted = useRef(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload: () => controller.current?.onNeedReload(),
    // Un onglet resté ouvert longtemps apprend aussi qu'une version est parue, sans rechargement.
    onRegisteredSW: (_url, registration) => {
      stopChecks.current?.();
      // Un enregistrement qui aboutit après le démontage ne lance rien que personne n'arrêterait.
      if (registration && !unmounted.current)
        stopChecks.current = scheduleUpdateChecks(registration, CLIENT_SETTINGS.updateCheckMinutes);
    },
  });
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      stopChecks.current?.();
    };
  }, []);
  controller.current ??= createUpdateController({
    reload: () => window.location.reload(),
    offer: () => setNeedRefresh(true),
  });
  return (
    // Sans nom tant qu'elle est vide : pas de repère « Nouvelle version » dans la page sans raison.
    <div aria-live="polite">
      {needRefresh && (
        <UpdateBanner
          onUpdate={() => controller.current?.update(() => void updateServiceWorker(true))}
          onLater={() => setNeedRefresh(false)}
        />
      )}
    </div>
  );
}
