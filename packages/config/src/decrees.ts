import { z } from 'zod';

/**
 * Décrets (docs/specs/06-cites-politique-communaute.md, 6.3 ; #261). Le catalogue est fermé : le moteur ne
 * connaît que les modèles de `models`, et une version de configuration n'ouvre que ceux qu'elle borne. Les
 * paramètres d'un décret sont validés contre ces bornes (`boundedDecreeParamsSchemas` de `@oikos/contracts`,
 * qui reprend ce catalogue et ces plafonds techniques ; un test de `apps/api` vérifie qu'ils restent alignés).
 * Lue par les joueurs (vue `public.decree_rules`) : n'y ranger aucun paramètre qui doive rester caché.
 */
const id = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const days = z.number().int().min(1).max(366);
/** Montant d'une dépense, en oboles : au plus mille milliards, loin sous les entiers sûrs. */
const oboles = z.number().int().min(1).max(1_000_000_000_000);

export const decreesSchema = z.strictObject({
  /** Durée du vote : au moins autant de jours de jeu pleins après la proposition. */
  votingDays: days,
  /** Quorum : votes exprimés au moins égaux à cette part des citoyens de la cité, en points de base. */
  quorumBps: z.number().int().min(0).max(10_000),
  /** Décrets proposés et non encore dépouillés, par cité. */
  maxOpenPerCity: z.number().int().min(1).max(100),
  /** Plafond d'un décret de dépense, en part du trésor de la cité à la proposition (points de base). */
  spendingCapShareBps: z.number().int().min(0).max(10_000),
  /** Modèles ouverts et bornes de leurs paramètres ; un modèle absent ne se propose pas. */
  models: z.strictObject({
    /** Taux de la taxe de marché de la cité, borné par le monde (au plus le plafond de `marketTax`). */
    market_tax_rate: z
      .strictObject({
        minRateBps: z.number().int().min(0).max(5000),
        maxRateBps: z.number().int().min(0).max(5000),
      })
      .optional(),
    /** Coefficient du droit de port de la cité, borné par le monde, de ×0 à ×10. */
    port_dues: z
      .strictObject({
        minCoefficientBps: z.number().int().min(0).max(100_000),
        maxCoefficientBps: z.number().int().min(0).max(100_000),
      })
      .optional(),
    /** Grands travaux : un montant pris au trésor de la cité. */
    public_works: z.strictObject({ minOboles: oboles, maxOboles: oboles }).optional(),
    /** Fête : un montant, une durée en jours de jeu et des biens, pris dans `goodIds`. */
    festival: z
      .strictObject({
        minOboles: oboles,
        maxOboles: oboles,
        minDays: days,
        maxDays: days,
        /** Biens qu'une fête peut célébrer (identifiants de `goods`), sans doublon. */
        goodIds: z.array(id).min(1).max(60),
        /** Biens d'une même fête, au plus. */
        maxGoods: z.number().int().min(1).max(20),
      })
      .optional(),
  }),
});
export type Decrees = z.infer<typeof decreesSchema>;

/**
 * Contrôles qui demandent le reste de la configuration ou plusieurs champs : chaque minimum au plus égal
 * à son maximum, et des biens de fête connus, chacun une fois. Rend des chemins sous `decrees`.
 */
export function decreesIssues(
  decrees: Decrees,
  goods: ReadonlySet<string>,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  // Chaque borne `minX` a sa borne `maxX` dans le même modèle.
  for (const [model, bounds] of Object.entries(decrees.models))
    for (const [key, min] of Object.entries(bounds ?? {})) {
      const max: unknown = (bounds as Record<string, unknown>)[`max${key.slice(3)}`];
      if (key.startsWith('min') && typeof min === 'number' && typeof max === 'number' && min > max)
        issues.push({
          path: ['models', model, `max${key.slice(3)}`],
          message: 'below the minimum',
        });
    }
  decrees.models.festival?.goodIds.forEach((goodId, index, all) => {
    if (!goods.has(goodId) || all.indexOf(goodId) < index)
      issues.push({
        path: ['models', 'festival', 'goodIds', index],
        message: `unknown or duplicate good "${goodId}"`,
      });
  });
  return issues;
}
