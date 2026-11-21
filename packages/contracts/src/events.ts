import { z } from 'zod';
import {
  adminRoleGrantedSchema,
  adminRoleRevokedSchema,
  configActivationCancelledSchema,
  configActivationScheduledSchema,
  configVersionPublishedSchema,
  goodBoughtBackSchema,
} from './admin';
import { directChannelOpenedSchema, messagePostedSchema } from './chat';
import {
  archonElectedSchema,
  ballotCastSchema,
  candidacyFiledSchema,
  candidacyWithdrawnSchema,
  citizenshipGrantedSchema,
} from './city';
import {
  decreeAdoptedSchema,
  decreeAppliedSchema,
  decreeLapsedSchema,
  decreeProposedSchema,
  decreeRejectedSchema,
  decreeVoteCastSchema,
} from './decree';
import { honorChangedSchema } from './honor';
import { liturgyAssignedSchema, liturgyLeviedSchema, liturgyPerformedSchema } from './liturgy';
import { loanDisbursedSchema, loanRepaidSchema } from './loan';
import { messageReportedSchema, sanctionAppealedSchema } from './moderation';
import {
  appealDecidedSchema,
  exclusionConfirmedSchema,
  exclusionWithdrawnSchema,
  messageHiddenSchema,
  reportsResolvedSchema,
  sanctionLiftedSchema,
  sanctionLiftProposedSchema,
  sanctionPronouncedSchema,
} from './moderation-admin';
import { orderCancelledSchema, orderPlacedSchema, tradeExecutedSchema } from './market';
import {
  houseOstracizedSchema,
  ostracismOpenedSchema,
  ostracismTalliedSchema,
  ostraconCastSchema,
} from './ostracism';
import { propertyBoughtSchema, propertyRenovatedSchema } from './property';
import {
  leaseEndedSchema,
  leaseEndRequestedSchema,
  leaseStartedSchema,
  propertyOfferedSchema,
  propertyOfferWithdrawnSchema,
  propertySoldSchema,
} from './property-market';
import { shipAcquiredSchema } from './ship';
import {
  stewardActionFailedSchema,
  stewardDismissedSchema,
  stewardHiredSchema,
  stewardInstructionSubmittedSchema,
  stewardRulesSetSchema,
} from './steward';
import { graceInvokedSchema, offeringMadeSchema, oracleConsultedSchema } from './temple';
import { voyageArrivedSchema, voyageDepartedSchema } from './voyage';
import {
  siteAcquiredSchema,
  siteCollectedSchema,
  siteRecipeChangedSchema,
  siteRestartedSchema,
  upkeepSettledSchema,
} from './site';

/** Événements de domaine produits par les commandes et par le tick (temps réel, télémétrie, chronique). */
export const houseFoundedSchema = z.strictObject({
  type: z.literal('HouseFounded'),
  payload: z.strictObject({
    houseId: z.uuid(),
    worldId: z.uuid(),
    cityId: z.uuid(),
    name: z.string(),
  }),
});

export const houseRenamedSchema = z.strictObject({
  type: z.literal('HouseRenamed'),
  payload: z.strictObject({ houseId: z.uuid(), previousName: z.string(), name: z.string() }),
});

/**
 * Événement de la clôture (8.3, #715) : la maison PNJ de secours d'une filière d'une cité est fondée, avec ses sites et
 * sa dotation, versée par le robinet `faucet_npc_house_grant` (nulle : aucune écriture).
 */
export const npcHouseFoundedSchema = z.strictObject({
  type: z.literal('NpcHouseFounded'),
  payload: z.strictObject({
    houseId: z.uuid(),
    worldId: z.uuid(),
    cityId: z.uuid(),
    chainId: z.string().min(1),
    name: z.string(),
    sites: z.number().int().positive(),
    grantOboles: z.number().int().nonnegative(),
    gameDay: z.number().int().nonnegative(),
  }),
});

/** Un site d'une maison PNJ fermé ou rouvert par le retrait (8.3, #717), à la part des joueurs qui l'a décidé. */
const npcHouseSiteMove = z.strictObject({
  houseId: z.uuid(),
  worldId: z.uuid(),
  cityId: z.uuid(),
  chainId: z.string().min(1),
  siteId: z.uuid(),
  /** Part des maisons de joueurs dans les ventes du bien de la filière, sur la fenêtre, en points de base. */
  shareBps: z.number().int().min(0).max(10_000),
  /** Sites encore ouverts après le mouvement. */
  openSites: z.number().int().nonnegative(),
  gameDay: z.number().int().nonnegative(),
});

/** Événement de la clôture (8.3, #717) : les joueurs tiennent le marché de la filière, la maison PNJ ferme un site. */
export const npcHouseRetreatedSchema = z.strictObject({
  type: z.literal('NpcHouseRetreated'),
  payload: npcHouseSiteMove,
});

/** Événement de la clôture (8.3, #717) : les joueurs ne tiennent plus le marché, la maison PNJ rouvre un site. */
export const npcHouseReturnedSchema = z.strictObject({
  type: z.literal('NpcHouseReturned'),
  payload: npcHouseSiteMove,
});

export const domainEventSchema = z.discriminatedUnion('type', [
  houseFoundedSchema,
  houseRenamedSchema,
  npcHouseFoundedSchema,
  npcHouseRetreatedSchema,
  npcHouseReturnedSchema,
  siteCollectedSchema,
  siteAcquiredSchema,
  siteRecipeChangedSchema,
  siteRestartedSchema,
  upkeepSettledSchema,
  stewardHiredSchema,
  stewardRulesSetSchema,
  stewardDismissedSchema,
  stewardActionFailedSchema,
  stewardInstructionSubmittedSchema,
  shipAcquiredSchema,
  propertyBoughtSchema,
  propertyRenovatedSchema,
  offeringMadeSchema,
  graceInvokedSchema,
  oracleConsultedSchema,
  propertyOfferedSchema,
  propertyOfferWithdrawnSchema,
  propertySoldSchema,
  leaseStartedSchema,
  leaseEndRequestedSchema,
  leaseEndedSchema,
  citizenshipGrantedSchema,
  archonElectedSchema,
  honorChangedSchema,
  candidacyFiledSchema,
  candidacyWithdrawnSchema,
  ballotCastSchema,
  decreeProposedSchema,
  decreeVoteCastSchema,
  decreeAdoptedSchema,
  decreeRejectedSchema,
  decreeAppliedSchema,
  decreeLapsedSchema,
  ostracismOpenedSchema,
  ostraconCastSchema,
  ostracismTalliedSchema,
  houseOstracizedSchema,
  liturgyAssignedSchema,
  liturgyPerformedSchema,
  liturgyLeviedSchema,
  loanDisbursedSchema,
  loanRepaidSchema,
  voyageDepartedSchema,
  voyageArrivedSchema,
  directChannelOpenedSchema,
  messagePostedSchema,
  messageReportedSchema,
  sanctionAppealedSchema,
  sanctionPronouncedSchema,
  exclusionConfirmedSchema,
  messageHiddenSchema,
  reportsResolvedSchema,
  appealDecidedSchema,
  exclusionWithdrawnSchema,
  sanctionLiftProposedSchema,
  sanctionLiftedSchema,
  orderPlacedSchema,
  tradeExecutedSchema,
  orderCancelledSchema,
  configVersionPublishedSchema,
  configActivationScheduledSchema,
  configActivationCancelledSchema,
  adminRoleGrantedSchema,
  adminRoleRevokedSchema,
  goodBoughtBackSchema,
]);
export type DomainEvent = z.infer<typeof domainEventSchema>;
export type DomainEventType = DomainEvent['type'];
