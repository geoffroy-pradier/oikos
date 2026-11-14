/**
 * Décide quoi faire quand le service worker change de version (vite-plugin-pwa, mode `prompt`).
 *
 * Un seul onglet recharge : celui où le joueur a demandé la mise à jour. Quand un autre onglet l'a
 * acceptée, la nouvelle version prend la main ici aussi ; on ne recharge pas sous les doigts du joueur,
 * on lui repropose le bandeau, dont le bouton recharge alors simplement la page.
 */
export function createUpdateController({
  reload,
  offer,
}: {
  reload: () => void;
  offer: () => void;
}) {
  let requestedHere = false;
  let activatedElsewhere = false;
  return {
    /** « Mettre à jour » : active la version en attente, ou recharge si elle est déjà active. */
    update(activateWaiting: () => void) {
      requestedHere = true;
      if (activatedElsewhere) reload();
      else activateWaiting();
    },
    /** La nouvelle version contrôle désormais cet onglet. */
    onNeedReload() {
      if (requestedHere) return reload();
      activatedElsewhere = true;
      offer();
    },
  };
}
