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

/**
 * Plafond technique d'une consigne en langage naturel (#280), en caractères (points de code) : il borne les données,
 * donc le coût d'entrée, d'un appel à la passerelle IA (ADR 0005).
 */
export const MAX_STEWARD_INSTRUCTION_LENGTH = 500;

/**
 * Commande `steward.submitInstruction` (4.4, #280) : la maison écrit une consigne à un de ses intendants, que le
 * moteur fera traduire en règles de la grammaire et simuler. Le texte n'entre pas au journal des commandes.
 */
export const stewardSubmitInstructionInputSchema = z.strictObject({
  stewardId: z.uuid(),
  text: z
    .string()
    .trim()
    .min(1)
    .refine((text) => [...text].length <= MAX_STEWARD_INSTRUCTION_LENGTH, 'too long'),
});
export type StewardSubmitInstructionInput = z.infer<typeof stewardSubmitInstructionInputSchema>;

export const stewardSubmitInstructionOutputSchema = z.object({
  instructionId: z.uuid(),
  stewardId: z.uuid(),
  /** Instant de la consigne (ISO 8601) ; la proposition suit au prochain passage du moteur. */
  submittedAt: z.iso.datetime(),
});
export type StewardSubmitInstructionOutput = z.infer<typeof stewardSubmitInstructionOutputSchema>;

export const STEWARD_SUBMIT_INSTRUCTION_ERROR_CODES = [
  /** Intendant inconnu, renvoyé, ou d'une autre maison : indiscernables. */
  'STEWARD_NOT_FOUND',
  /** IA coupée, plafond du mois atteint, ou consignes du jour de la maison épuisées : le formulaire reste. */
  'AI_UNAVAILABLE',
  /** Une consigne de cet intendant attend encore sa proposition. */
  'INSTRUCTION_PENDING',
] as const;

/**
 * Refus motivé d'une consigne, rendu par le moteur à la place de règles : `AI_UNAVAILABLE`, IA coupée, plafond
 * atteint, délai ou panne ; `INVALID_PROPOSAL`, réponse rejetée par le schéma de la grammaire ; `OUT_OF_GRAMMAR`,
 * consigne qui demande autre chose que les règles de la grammaire ; `AMBIGUOUS`, consigne incomplète ou ambiguë.
 */
export const STEWARD_PROPOSAL_REFUSALS = [
  'AI_UNAVAILABLE',
  'INVALID_PROPOSAL',
  'OUT_OF_GRAMMAR',
  'AMBIGUOUS',
] as const;
export type StewardProposalRefusal = (typeof STEWARD_PROPOSAL_REFUSALS)[number];

/** Une consigne est donnée : ni son texte ni ses règles ne sont dans l'événement, privé comme elle. */
export const stewardInstructionSubmittedSchema = z.strictObject({
  type: z.literal('StewardInstructionSubmitted'),
  payload: z.strictObject({ ...stewardRef, instructionId: z.uuid() }),
});

/** Commandes que mène un intendant (#279), par le cœur partagé avec le joueur (ADR 0009). */
export const STEWARD_COMMANDS = ['site.collect', 'market.placeOrder'] as const;
export type StewardCommand = (typeof STEWARD_COMMANDS)[number];

const tickRef = {
  /** Tick dont l'intendant a mené l'opération, et rang de l'opération dans ce tick (0 d'abord). */
  tickIndex: z.number().int().nonnegative(),
  rank: z
    .number()
    .int()
    .min(0)
    .max(MAX_STEWARD_RULES - 1),
};

/**
 * Résumé d'une opération d'intendant, gardé avec elle et lu par la fiche du site (vue `my_steward_operations`) :
 * une récolte dit ses cycles et ses extrants ; un ordre dit ce qu'il proposait et, réussi, ce qui s'est échangé
 * et son état. Un refus ne garde que ce qui était tenté.
 */
export const stewardOperationSummarySchema = z.discriminatedUnion('command', [
  z.strictObject({
    command: z.literal('site.collect'),
    cycles: z.number().int().positive().optional(),
    outputs: z
      .array(z.strictObject({ goodId, quantity: z.number().int().nonnegative() }))
      .optional(),
  }),
  z.strictObject({
    command: z.literal('market.placeOrder'),
    side: z.enum(['buy', 'sell']),
    goodId,
    price: unitPrice,
    quantity: units.min(1),
    /** Unités échangées à l'arrivée de l'ordre. */
    traded: units.optional(),
    status: z.enum(['open', 'filled', 'cancelled']).optional(),
  }),
]);
export type StewardOperationSummary = z.infer<typeof stewardOperationSummarySchema>;

/**
 * Une opération d'intendant refusée (stock, trésorerie, bien retiré…) : notée au journal des commandes au nom de
 * la maison, sans effet, elle ne retient ni les règles suivantes ni les autres intendants. Privé, comme les règles.
 */
export const stewardActionFailedSchema = z.strictObject({
  type: z.literal('StewardActionFailed'),
  payload: z.strictObject({
    ...stewardRef,
    ...tickRef,
    rule: stewardRuleSchema,
    command: z.enum(STEWARD_COMMANDS),
    /** Code d'erreur métier de la commande, celui que le joueur recevrait. */
    code: z.string().regex(/^[A-Z][A-Z_]{1,63}$/),
  }),
});

const position = z
  .number()
  .int()
  .min(0)
  .max(MAX_STEWARD_RULES - 1);
/**
 * Simulation à blanc d'une règle proposée (#280) : ce qu'elle ferait maintenant, menée dans l'ordre des règles par le
 * cœur de la commande, dans une transaction annulée. `idle` : rien à faire ; `ok` : la commande réussirait ;
 * `rejected` : elle serait refusée pour la raison `code`, celle que le joueur recevrait.
 */
export const stewardSimulationStepSchema = z.discriminatedUnion('status', [
  z.strictObject({ position, status: z.literal('idle') }),
  z.strictObject({
    position,
    status: z.literal('ok'),
    summary: stewardOperationSummarySchema,
  }),
  z.strictObject({
    position,
    status: z.literal('rejected'),
    code: z.string().regex(/^[A-Z][A-Z_]{1,63}$/),
    summary: stewardOperationSummarySchema,
  }),
]);
export type StewardSimulationStep = z.infer<typeof stewardSimulationStepSchema>;
export const stewardSimulationSchema = z.array(stewardSimulationStepSchema).max(MAX_STEWARD_RULES);
