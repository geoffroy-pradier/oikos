import { z } from 'zod';
import { MAX_ORDER_PRICE, MAX_ORDER_QUANTITY } from './market';

/** Plafond technique des règles d'un intendant ; la configuration en fixe le nombre (`stewards.rulesPerSteward`). */
export const MAX_STEWARD_RULES = 20;

const goodId = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
/** Prix par unité, en oboles, borné comme le prix d'un ordre de l'agora. */
const unitPrice = z.number().int().positive().max(MAX_ORDER_PRICE);
/** Quantité d'un bien en stock, en unités, bornée comme la quantité d'un ordre. */
const units = z.number().int().nonnegative().max(MAX_ORDER_QUANTITY);

/**
 * Grammaire fermée des règles d'un intendant (4.4, 8.1) : trois règles, chaque nombre borné. Le formulaire du
 * joueur la saisit ; la consigne en langage naturel (#280) n'en est qu'une traduction, validée par ce schéma.
 * - `collect` : récolter le site dès qu'un cycle au moins est récoltable ;
 * - `sell` : vendre le bien à l'agora de la cité du site, à `minPriceOboles` l'unité ou plus, en gardant
 *   `keepUnits` unités en stock ;
 * - `buy` : racheter un intrant de la recette du site, à `maxPriceOboles` l'unité ou moins, jusqu'à
 *   `targetUnits` unités en stock.
 */
export const stewardRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('collect') }),
  z.strictObject({
    kind: z.literal('sell'),
    goodId,
    minPriceOboles: unitPrice,
    keepUnits: units,
  }),
  z.strictObject({
    kind: z.literal('buy'),
    goodId,
    maxPriceOboles: unitPrice,
    targetUnits: units.min(1),
  }),
]);
export type StewardRule = z.infer<typeof stewardRuleSchema>;

/** Une règle par sorte et par bien : deux seuils pour le même geste seraient contradictoires. */
const ruleKey = (rule: StewardRule) =>
  rule.kind === 'collect' ? rule.kind : `${rule.kind}:${rule.goodId}`;

/** Les règles d'un intendant, menées dans l'ordre de la liste (#279). Vide : l'intendant ne fait rien. */
export const stewardRulesSchema = z
  .array(stewardRuleSchema)
  .max(MAX_STEWARD_RULES)
  .superRefine((rules, ctx) => {
    const seen = new Set<string>();
    rules.forEach((rule, index) => {
      const key = ruleKey(rule);
      if (seen.has(key))
        ctx.addIssue({ code: 'custom', path: [index], message: `duplicate rule "${key}"` });
      seen.add(key);
    });
  });

/** Commande `steward.hire` : la maison embauche un intendant pour un de ses sites (4.4). */
export const stewardHireInputSchema = z.strictObject({ siteId: z.uuid() });
export type StewardHireInput = z.infer<typeof stewardHireInputSchema>;

export const stewardHireOutputSchema = z.object({
  stewardId: z.uuid(),
  siteId: z.uuid(),
  /** Nom tiré de la liste de la configuration (`stewards.names`). */
  name: z.string().min(1),
  /** Instant de l'embauche (ISO 8601). L'intendant n'agit qu'après la première clôture qui le paie. */
  hiredAt: z.iso.datetime(),
});
export type StewardHireOutput = z.infer<typeof stewardHireOutputSchema>;

export const STEWARD_HIRE_ERROR_CODES = [
  /** Site inconnu, ou d'une autre maison : indiscernables. */
  'SITE_NOT_FOUND',
  /** Le site a déjà son intendant : un intendant par site. */
  'SITE_HAS_STEWARD',
  /** Tous les postes d'intendant du siège sont pris (aucun dans une version publiée avant les intendants). */
  'STEWARD_LIMIT_REACHED',
] as const;
export type StewardHireErrorCode = (typeof STEWARD_HIRE_ERROR_CODES)[number];

/** Commande `steward.setRules` : remplace toutes les règles d'un intendant de la maison. */
export const stewardSetRulesInputSchema = z.strictObject({
  stewardId: z.uuid(),
  rules: stewardRulesSchema,
});
export type StewardSetRulesInput = z.infer<typeof stewardSetRulesInputSchema>;

export const stewardSetRulesOutputSchema = z.object({
  stewardId: z.uuid(),
  rules: z.array(stewardRuleSchema),
});
export type StewardSetRulesOutput = z.infer<typeof stewardSetRulesOutputSchema>;

export const STEWARD_SET_RULES_ERROR_CODES = [
  /** Intendant inconnu, renvoyé, ou d'une autre maison : indiscernables. */
  'STEWARD_NOT_FOUND',
  /** Plus de règles que la configuration n'en admet par intendant (`stewards.rulesPerSteward`). */
  'TOO_MANY_RULES',
  /** Bien absent de la configuration en vigueur. */
  'GOOD_NOT_FOUND',
  /** Règle de rachat d'un bien qui n'est pas un intrant de la recette du site. */
  'NOT_AN_INPUT',
] as const;
export type StewardSetRulesErrorCode = (typeof STEWARD_SET_RULES_ERROR_CODES)[number];

/** Commande `steward.dismiss` : renvoie un intendant ; ses règles cessent avec lui, son poste se libère. */
export const stewardDismissInputSchema = z.strictObject({ stewardId: z.uuid() });
export type StewardDismissInput = z.infer<typeof stewardDismissInputSchema>;

export const stewardDismissOutputSchema = z.object({
  stewardId: z.uuid(),
  siteId: z.uuid(),
  /** Instant du renvoi (ISO 8601). */
  dismissedAt: z.iso.datetime(),
});
export type StewardDismissOutput = z.infer<typeof stewardDismissOutputSchema>;

export const STEWARD_DISMISS_ERROR_CODES = ['STEWARD_NOT_FOUND'] as const;

const stewardRef = { stewardId: z.uuid(), houseId: z.uuid(), siteId: z.uuid() };

export const stewardHiredSchema = z.strictObject({
  type: z.literal('StewardHired'),
  payload: z.strictObject({ ...stewardRef, name: z.string().min(1) }),
});

/** Les règles d'un intendant sont privées : l'événement reste au serveur, comme toute la table (12). */
export const stewardRulesSetSchema = z.strictObject({
  type: z.literal('StewardRulesSet'),
  payload: z.strictObject({ ...stewardRef, rules: z.array(stewardRuleSchema) }),
});

export const stewardDismissedSchema = z.strictObject({
  type: z.literal('StewardDismissed'),
  payload: z.strictObject(stewardRef),
});
