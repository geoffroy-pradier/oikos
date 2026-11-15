import { z } from 'zod';
import {
  adminRoleGrantedSchema,
  adminRoleRevokedSchema,
  configActivationCancelledSchema,
  configActivationScheduledSchema,
  configVersionPublishedSchema,
  goodBoughtBackSchema,
} from './admin';
import { orderCancelledSchema, orderPlacedSchema, tradeExecutedSchema } from './market';
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
