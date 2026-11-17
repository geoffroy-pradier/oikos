/**
 * Réglages du client joueur qui ne relèvent pas de l'équilibrage : ils ne sont pas versionnés en base,
 * mais restent hors du code des applications (règle 1 du `CLAUDE.md`).
 */
export const CLIENT_SETTINGS = Object.freeze({
  /**
   * Intervalle, en minutes, entre deux vérifications d'une nouvelle version du client par le service
   * worker (`registration.update()`), tant que l'onglet est visible et en ligne. Une version trouvée est
   * proposée par le bandeau, jamais imposée (`docs/specs/10-ux-ui.md`).
   */
  updateCheckMinutes: 60,
  /**
   * Intervalle, en secondes, entre deux relectures des messages de l'onglet Messages tant que Realtime ne
   * les apporte pas (abonnement refusé, coupé ou pas encore établi) ; l'écran le dit (ADR 0008).
   */
  chatPollSeconds: 15,
  /**
   * Intervalle, en secondes, entre deux relectures de sécurité des messages quand Realtime les apporte : une
   * diffusion peut tomber en panne sans que l'abonnement le sache (partition du jour manquante, fonction de
   * Realtime changée), le message n'est alors manqué que jusqu'à cette relecture (ADR 0008).
   */
  chatSafetyRereadSeconds: 120,
});
