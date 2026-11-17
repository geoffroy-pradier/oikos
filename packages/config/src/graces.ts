import { z } from 'zod';

/**
 * Grâces (docs/specs/07-dieux-faveur-evenements.md, 7.1 ; #266). Le catalogue des effets est fermé : chacun
 * s'applique à la prochaine action admise de la maison qui l'a invoquée. Une grâce de la configuration choisit
 * l'un de ces effets, son dieu, son ampleur, sa Charis requise et dépensée et sa recharge : une grâce nouvelle
 * ne demande aucun code, un effet nouveau si.
 * - `blessed_harvest` : une récolte d'un site de matière première rend ⌊quantité × ampleur ÷ 10 000⌋ de plus ;
 * - `inspired_workshop` : de même pour une récolte d'atelier, sans intrant supplémentaire ;
 * - `fair_wind` : le prochain départ d'un navire dure ⌈durée × (10 000 − ampleur) ÷ 10 000⌉ secondes.
 * Lue par les joueurs (vue `public.temple_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
export const GRACE_EFFECTS = ['blessed_harvest', 'inspired_workshop', 'fair_wind'] as const;
export type GraceEffect = (typeof GRACE_EFFECTS)[number];

/**
 * Ampleur au plus, par effet, en points de base : une récolte au plus doublée ; un trajet au plus deux fois
 * plus court, jamais instantané. Bornes de sûreté du catalogue, pas d'équilibrage.
 */
export const GRACE_MAX_MAGNITUDE_BPS: Readonly<Record<GraceEffect, number>> = {
  blessed_harvest: 10_000,
  inspired_workshop: 10_000,
  fair_wind: 5_000,
};

const id = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const charis = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const graceSchema = z.strictObject({
  id,
  /** Dieu qui l'accorde, parmi `gods` : sa Charis est requise et dépensée. */
  godId: id,
  effect: z.enum(GRACE_EFFECTS),
  /** Ampleur de l'effet, en points de base, au plus `GRACE_MAX_MAGNITUDE_BPS` de l'effet. */
  magnitudeBps: z.number().int().min(1).max(10_000),
  /** Charis envers le dieu qu'il faut avoir pour l'invoquer. */
  charisRequired: charis,
  /** Charis dépensée à l'invocation, au plus la Charis requise. */
  charisSpent: charis,
  /**
   * Recharge, en jours de jeu : invoquée le jour de jeu J, la grâce se réinvoque à partir de la clôture qui
   * ouvre le jour J + recharge, et pas tant qu'une invocation attend encore son action.
   */
  cooldownDays: z.number().int().min(1).max(366),
});
export type Grace = z.infer<typeof graceSchema>;

/**
 * Contrôles qui demandent plusieurs champs ou le reste de la configuration : des identifiants uniques, un dieu
 * connu, une ampleur dans la borne de son effet, une Charis dépensée au plus égale à la Charis requise. Rend
 * des chemins sous `graces`.
 */
export function gracesIssues(
  graces: readonly Grace[],
  gods: ReadonlySet<string>,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  graces.forEach((grace, index) => {
    if (graces.findIndex((other) => other.id === grace.id) < index)
      issues.push({ path: [], message: `duplicate id "${grace.id}"` });
    if (!gods.has(grace.godId))
      issues.push({ path: [index, 'godId'], message: `unknown god "${grace.godId}"` });
    if (grace.magnitudeBps > GRACE_MAX_MAGNITUDE_BPS[grace.effect])
      issues.push({
        path: [index, 'magnitudeBps'],
        message: `at most ${GRACE_MAX_MAGNITUDE_BPS[grace.effect]} for ${grace.effect}`,
      });
    if (grace.charisSpent > grace.charisRequired)
      issues.push({ path: [index, 'charisSpent'], message: 'above the Charis required' });
  });
  return issues;
}
