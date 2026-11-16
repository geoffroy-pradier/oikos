import { z } from 'zod';

/**
 * Décrets de la cité (docs/specs/06-cites-politique-communaute.md, 6.3 ; #261). Catalogue fermé de modèles
 * paramétrés : l'archonte en charge propose, les citoyens votent, la clôture dépouille. Les bornes de
 * chaque paramètre viennent de la configuration en vigueur (section `decrees`).
 */
export const DECREE_MODELS = ['market_tax_rate', 'port_dues', 'public_works', 'festival'] as const;
export type DecreeModel = (typeof DECREE_MODELS)[number];

const goodId = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
/** Plafonds techniques, ceux du schéma de configuration : les bornes de jeu sont plus étroites. */
const oboles = z.number().int().min(1).max(1_000_000_000_000);
const days = z.number().int().min(1).max(366);
const rateBps = z.number().int().min(0).max(5000);
const coefficientBps = z.number().int().min(0).max(100_000);

/** Bornes des paramètres de chaque modèle ouvert (`decrees.models` de la configuration). */
export interface DecreeModelBounds {
  market_tax_rate?: { minRateBps: number; maxRateBps: number } | undefined;
  port_dues?: { minCoefficientBps: number; maxCoefficientBps: number } | undefined;
  public_works?: { minOboles: number; maxOboles: number } | undefined;
  festival?:
    | {
        minOboles: number;
        maxOboles: number;
        minDays: number;
        maxDays: number;
        goodIds: readonly string[];
        maxGoods: number;
      }
    | undefined;
}

const distinct = (values: readonly string[]) => new Set(values).size === values.length;
const proposal = <M extends DecreeModel, P extends z.ZodType>(model: M, params: P) =>
  z.strictObject({ model: z.literal(model), params });
const between = (schema: z.ZodNumber, min: number, max: number) => schema.min(min).max(max);

/** Un décret tel que proposé, dans les plafonds techniques seulement. */
export const decreeProposalSchema = z.discriminatedUnion('model', [
  proposal('market_tax_rate', z.strictObject({ rateBps })),
  proposal('port_dues', z.strictObject({ coefficientBps })),
  proposal('public_works', z.strictObject({ amountOboles: oboles })),
  proposal(
    'festival',
    z.strictObject({
      amountOboles: oboles,
      days,
      goodIds: z.array(goodId).min(1).max(20).refine(distinct, 'each good once'),
    }),
  ),
]);
export type DecreeProposal = z.infer<typeof decreeProposalSchema>;

/** Paramètres d'un modèle de décret. */
export type DecreeParams<M extends DecreeModel> = Extract<DecreeProposal, { model: M }>['params'];
/** Schéma des paramètres de chaque modèle ouvert, borné par la configuration. */
export type BoundedDecreeParamsSchemas = { [M in DecreeModel]?: z.ZodType<DecreeParams<M>> };

/**
 * Schémas des paramètres bornés par la configuration en vigueur : un par modèle ouvert, chaque paramètre
 * entre ses bornes, les biens d'une fête pris dans ceux qu'elle admet. Un modèle fermé n'en a pas.
 */
export function boundedDecreeParamsSchemas(bounds: DecreeModelBounds): BoundedDecreeParamsSchemas {
  const schemas: BoundedDecreeParamsSchemas = {};
  const tax = bounds.market_tax_rate;
  if (tax)
    schemas.market_tax_rate = z.strictObject({
      rateBps: between(rateBps, tax.minRateBps, tax.maxRateBps),
    });
  const port = bounds.port_dues;
  if (port)
    schemas.port_dues = z.strictObject({
      coefficientBps: between(coefficientBps, port.minCoefficientBps, port.maxCoefficientBps),
    });
  const works = bounds.public_works;
  if (works)
    schemas.public_works = z.strictObject({
      amountOboles: between(oboles, works.minOboles, works.maxOboles),
    });
  const festival = bounds.festival;
  if (festival)
    schemas.festival = z.strictObject({
      amountOboles: between(oboles, festival.minOboles, festival.maxOboles),
      days: between(days, festival.minDays, festival.maxDays),
      goodIds: z
        .array(goodId.refine((good) => festival.goodIds.includes(good), 'not a festival good'))
        .min(1)
        .max(festival.maxGoods)
        .refine(distinct, 'each good once'),
    });
  return schemas;
}

/** Montant qu'un décret prend au trésor de la cité, en oboles ; nul pour un décret de taux. */
export function decreeSpendingOboles(decree: DecreeProposal): number {
  return decree.model === 'public_works' || decree.model === 'festival'
    ? decree.params.amountOboles
    : 0;
}

/** Commande `city.proposeDecree` : l'archonte en charge propose un décret à sa cité. */
export const cityProposeDecreeInputSchema = decreeProposalSchema;
export type CityProposeDecreeInput = z.infer<typeof cityProposeDecreeInputSchema>;
export const cityProposeDecreeOutputSchema = z.object({
  decreeId: z.uuid(),
  cityId: z.uuid(),
  model: z.enum(DECREE_MODELS),
  votingClosesAt: z.iso.datetime(),
});
export type CityProposeDecreeOutput = z.infer<typeof cityProposeDecreeOutputSchema>;

/**
 * Commande `city.voteDecree` : un citoyen de la cité vote pour ou contre, une fois par maison. Le vote est
 * secret : ni la réponse, ni l'événement, ni les lectures des joueurs ne disent ce que la maison a voté.
 */
export const cityVoteDecreeInputSchema = z.strictObject({
  decreeId: z.uuid(),
  approve: z.boolean(),
});
export type CityVoteDecreeInput = z.infer<typeof cityVoteDecreeInputSchema>;
export const cityVoteDecreeOutputSchema = z.object({
  decreeId: z.uuid(),
  castAt: z.iso.datetime(),
});
export type CityVoteDecreeOutput = z.infer<typeof cityVoteDecreeOutputSchema>;

export const CITY_PROPOSE_DECREE_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** La maison n'est pas l'archonte en charge de sa cité. */
  'NOT_ARCHON',
  /** Le modèle n'est pas ouvert par la configuration en vigueur (ou aucun ne l'est). */
  'DECREE_MODEL_CLOSED',
  /** Un paramètre sort des bornes de la configuration en vigueur. */
  'DECREE_PARAMS_OUT_OF_BOUNDS',
  /** La dépense dépasse la part du trésor qu'un décret peut engager (`spendingCapShareBps`). */
  'SPENDING_CAP_EXCEEDED',
  /** La cité a déjà autant de décrets au vote que la configuration en admet (`maxOpenPerCity`). */
  'TOO_MANY_OPEN_DECREES',
] as const;
export const CITY_VOTE_DECREE_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Aucun décret de ce monde sous cet identifiant. */
  'DECREE_NOT_FOUND',
  /** La maison n'est pas citoyenne de la cité du décret. */
  'NOT_CITIZEN',
  /** Le vote est clos ou dépouillé. */
  'VOTING_CLOSED',
  'ALREADY_VOTED',
] as const;

export const decreeProposedSchema = z.strictObject({
  type: z.literal('DecreeProposed'),
  payload: z.strictObject({
    decreeId: z.uuid(),
    cityId: z.uuid(),
    /** Maison de l'archonte qui propose. */
    houseId: z.uuid(),
    decree: decreeProposalSchema,
    votingClosesAt: z.iso.datetime(),
  }),
});
/** Un vote est déposé : l'événement nomme la maison qui vote, jamais son choix. */
export const decreeVoteCastSchema = z.strictObject({
  type: z.literal('DecreeVoteCast'),
  payload: z.strictObject({ decreeId: z.uuid(), cityId: z.uuid(), houseId: z.uuid() }),
});
const tallyPayload = z.strictObject({
  decreeId: z.uuid(),
  cityId: z.uuid(),
  model: z.enum(DECREE_MODELS),
  votesFor: z.number().int().nonnegative(),
  votesAgainst: z.number().int().nonnegative(),
  /** Citoyens de la cité à la fin du vote. */
  electorate: z.number().int().nonnegative(),
  quorumReached: z.boolean(),
});
/** Dépouillement : quorum atteint et majorité stricte des votes exprimés. */
export const decreeAdoptedSchema = z.strictObject({
  type: z.literal('DecreeAdopted'),
  payload: tallyPayload,
});
/** Dépouillement : quorum manqué, ou pas de majorité (égalité comprise). */
export const decreeRejectedSchema = z.strictObject({
  type: z.literal('DecreeRejected'),
  payload: tallyPayload,
});
/** Modèles de taux : leur application met une valeur en vigueur dans la cité (#262). */
const isRateModel = (model: DecreeModel) => model === 'market_tax_rate' || model === 'port_dues';
/**
 * Application d'un décret à la clôture : le décret tel que voté, et, pour un décret de taux (#262), le taux ou
 * le coefficient qu'il met en vigueur dans sa cité, borné par le monde, en points de base. Ils diffèrent
 * quand la configuration a resserré les bornes depuis le vote, ou ne borne plus le modèle (valeur du monde).
 * Un décret de dépense (#263) n'a pas de valeur en vigueur : `inForceBps` est absent, et seulement pour lui.
 */
export const decreeAppliedSchema = z.strictObject({
  type: z.literal('DecreeApplied'),
  payload: z
    .strictObject({
      decreeId: z.uuid(),
      cityId: z.uuid(),
      decree: decreeProposalSchema,
      inForceBps: z.number().int().min(0).max(100_000).optional(),
    })
    .refine((payload) => isRateModel(payload.decree.model) === (payload.inForceBps !== undefined), {
      message: 'a rate decree, and only a rate decree, has a value in force',
      path: ['inForceBps'],
    }),
});
