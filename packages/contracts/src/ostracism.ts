import { z } from 'zod';

/**
 * Ostracisme (docs/specs/06-cites-politique-communaute.md, 6.4 ; #722). Un décret `ostracism` adopté ouvre un
 * vote où chaque citoyen de la cité inscrit le nom d'un citoyen de la même cité. Le vote est secret, comme ceux
 * des élections et des décrets (ADR 0007) : ni la réponse, ni l'événement, ni les lectures des joueurs ne
 * disent quel nom une maison a inscrit. La clôture dépouille une fois.
 */

/** Commande `city.castOstracon` : la maison inscrit un nom, une fois par vote. */
export const cityCastOstraconInputSchema = z.strictObject({
  ostracismId: z.uuid(),
  /** Maison nommée : citoyenne de la cité du vote. */
  houseId: z.uuid(),
});
export type CityCastOstraconInput = z.infer<typeof cityCastOstraconInputSchema>;
export const cityCastOstraconOutputSchema = z.object({
  ostracismId: z.uuid(),
  castAt: z.iso.datetime(),
});
export type CityCastOstraconOutput = z.infer<typeof cityCastOstraconOutputSchema>;

export const CITY_CAST_OSTRACON_ERROR_CODES = [
  'HOUSE_NOT_FOUND',
  /** Aucun vote d'ostracisme de ce monde sous cet identifiant. */
  'OSTRACISM_NOT_FOUND',
  /** La maison qui vote n'est pas citoyenne de la cité du vote. */
  'NOT_CITIZEN',
  /** La maison nommée n'est pas citoyenne de la cité du vote. */
  'TARGET_NOT_CITIZEN',
  /** Le vote est clos ou dépouillé. */
  'VOTING_CLOSED',
  'ALREADY_VOTED',
] as const;

/**
 * Issue du dépouillement : la maison la plus nommée est ostracisée si les bulletins atteignent le quorum et
 * qu'elle est seule en tête ; sinon égalité (aucun bulletin compris) ou quorum manqué.
 */
export const OSTRACISM_OUTCOMES = ['ostracized', 'tie', 'no_quorum'] as const;
export type OstracismOutcome = (typeof OSTRACISM_OUTCOMES)[number];

const count = z.number().int().nonnegative();

/** Le décret adopté a ouvert le vote, avec les règles de la configuration de cette clôture. */
export const ostracismOpenedSchema = z.strictObject({
  type: z.literal('OstracismOpened'),
  payload: z.strictObject({
    ostracismId: z.uuid(),
    decreeId: z.uuid(),
    cityId: z.uuid(),
    votingClosesAt: z.iso.datetime(),
    quorumBps: z.number().int().min(0).max(10_000),
    ostracismDays: z.number().int().min(1).max(366),
  }),
});
/** Un bulletin est déposé : l'événement nomme la maison qui vote, jamais le nom inscrit. */
export const ostraconCastSchema = z.strictObject({
  type: z.literal('OstraconCast'),
  payload: z.strictObject({ ostracismId: z.uuid(), cityId: z.uuid(), houseId: z.uuid() }),
});
/** Dépouillement, quelle qu'en soit l'issue. */
export const ostracismTalliedSchema = z.strictObject({
  type: z.literal('OstracismTallied'),
  payload: z.strictObject({
    ostracismId: z.uuid(),
    cityId: z.uuid(),
    outcome: z.enum(OSTRACISM_OUTCOMES),
    ballots: count,
    /** Citoyens de la cité à la fin du vote. */
    electorate: count,
    quorumReached: z.boolean(),
  }),
});
/**
 * Une maison est ostracisée jusqu'à `endsAt` : elle garde ses biens, sa Timè et son vote. Archonte en charge,
 * elle la quitte à cette clôture (`vacatedOfficeId`).
 */
export const houseOstracizedSchema = z.strictObject({
  type: z.literal('HouseOstracized'),
  payload: z.strictObject({
    ostracismId: z.uuid(),
    cityId: z.uuid(),
    houseId: z.uuid(),
    /** Bulletins qui la nomment. */
    ostraca: count,
    endsAt: z.iso.datetime(),
    vacatedOfficeId: z.uuid().nullable(),
  }),
});
