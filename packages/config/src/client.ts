import { z } from 'zod';

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

const permille = z.number().int().min(0).max(1000);
/**
 * Place d'une cité sur le dessin de l'archipel (onglet Carte, #696), en millièmes de sa largeur et de sa
 * hauteur depuis le coin haut gauche. Affichage seulement : aucune distance n'en est tirée, la durée d'une
 * route vient de la configuration du jeu.
 */
export const cityMapPositionSchema = z.strictObject({ x: permille, y: permille });
export type CityMapPosition = z.infer<typeof cityMapPositionSchema>;

/**
 * Place de chaque cité sur le dessin, par identifiant de cité de la configuration (`cities`). Le dessin est
 * dans le client, ces places aussi : une cité ajoutée par Olympe n'en a pas tant que le client ne dessine
 * pas son île, et la carte la place alors par la règle de repli (l'ellipse, `docs/specs/10-ux-ui.md`).
 */
export const CITY_MAP_POSITIONS: Readonly<Record<string, CityMapPosition>> = Object.freeze(
  z.record(z.string().min(1), cityMapPositionSchema).parse({
    kalliste: { x: 500, y: 514 },
    elaia: { x: 790, y: 229 },
    ampelos: { x: 255, y: 571 },
    halos: { x: 720, y: 743 },
    delphis: { x: 590, y: 136 },
    dikaia: { x: 420, y: 307 },
    emporion: { x: 690, y: 493 },
    gamelia: { x: 885, y: 679 },
    agrotera: { x: 85, y: 671 },
    phrourion: { x: 250, y: 871 },
    myrrhine: { x: 450, y: 843 },
    chalkeia: { x: 600, y: 921 },
  }),
);
