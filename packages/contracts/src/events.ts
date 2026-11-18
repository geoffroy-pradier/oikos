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
import { messageReportedSchema, sanctionAppealedSchema } from './moderation';
import {
  appealDecidedSchema,
  exclusionConfirmedSchema,
  exclusionWithdrawnSchema,
  messageHiddenSchema,
  reportsResolvedSchema,
  sanctionPronouncedSchema,
} from './moderation-admin';
import { orderCancelledSchema, orderPlacedSchema, tradeExecutedSchema } from './market';
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

export const domainEventSchema = z.discriminatedUnion('type', [
  houseFoundedSchema,
  houseRenamedSchema,
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
  candidacyFiledSchema,
  candidacyWithdrawnSchema,
  ballotCastSchema,
  decreeProposedSchema,
  decreeVoteCastSchema,
  decreeAdoptedSchema,
  decreeRejectedSchema,
  decreeAppliedSchema,
  decreeLapsedSchema,
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
