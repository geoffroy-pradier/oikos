/** Ce dont la vérification a besoin : la minuterie et l'état de l'onglet, remplaçables en test. */
export interface UpdateCheckEnvironment {
  setInterval: (callback: () => void, milliseconds: number) => unknown;
  clearInterval: (handle: unknown) => void;
  /** L'onglet est visible et en ligne : une vérification a un sens. */
  active: () => boolean;
}

const browser: UpdateCheckEnvironment = {
  setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
  clearInterval: (handle) => window.clearInterval(handle as number),
  active: () => document.visibilityState === 'visible' && navigator.onLine,
};

/**
 * Demande au service worker de vérifier une nouvelle version toutes les `minutes` minutes, tant que
 * l'onglet est visible et en ligne. Une version trouvée passe par le bandeau (`UpdatePrompt`) : rien
 * n'est installé sans le joueur. Un échec de vérification (réseau coupé entre-temps) est ignoré : la
 * suivante réessaiera. Rend la fonction qui arrête les vérifications.
 */
export function scheduleUpdateChecks(
  registration: Pick<ServiceWorkerRegistration, 'update'>,
  minutes: number,
  environment: UpdateCheckEnvironment = browser,
): () => void {
  const handle = environment.setInterval(() => {
    if (environment.active()) registration.update().catch(() => undefined);
  }, minutes * 60_000);
  return () => environment.clearInterval(handle);
}
