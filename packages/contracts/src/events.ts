import { z } from 'zod';
import { configActivationScheduledSchema, configVersionPublishedSchema } from './admin';
import { orderPlacedSchema, tradeExecutedSchema } from './market';
import { siteCollectedSchema } from './site';

/** Événements de domaine produits par les commandes (temps réel, télémétrie, chronique). */
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
  orderPlacedSchema,
  tradeExecutedSchema,
  configVersionPublishedSchema,
  configActivationScheduledSchema,
]);
export type DomainEvent = z.infer<typeof domainEventSchema>;
export type DomainEventType = DomainEvent['type'];
