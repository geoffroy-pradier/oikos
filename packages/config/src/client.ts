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
});
