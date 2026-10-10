import { z } from 'zod';
import { Id, Timestamp, Version } from './api.ts';
const Key = z.string().regex(/^[a-z0-9_]{1,64}$/);
export const TravelRequestSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  routeId: Key,
});
export const SpaceSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('official_genesis'),
    presetId: z.string(),
    contentVersion: z.number().int().positive(),
    snapshotVersion: z.literal(0),
  }),
  z.strictObject({
    kind: z.literal('world_event'),
    presetId: z.string(),
    contentVersion: z.number().int().positive(),
    snapshotVersion: z.literal(0),
    eventId: Id,
    eventVersion: Version,
  }),
]);
export const EstablishSpaceRequestSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
});
export const EnterPlaceRequestSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  placeId: Key,
});
export const SpacePlaceSchema = z.strictObject({
  id: Key,
  name: z.string(),
  description: z.string(),
  source: SpaceSourceSchema,
  contactActorIds: z.array(Id),
  appointmentIds: z.array(z.string()),
});
export const SpaceRouteSchema = z.strictObject({
  id: Key,
  fromPlaceId: Key,
  toPlaceId: Key,
  durationMinutes: z.number().int().min(1).max(120),
  modeLabel: z.string(),
  source: SpaceSourceSchema,
});
export const WorldSpaceSchema = z.strictObject({
  worldId: Id,
  worldVersion: Version,
  storyNow: Timestamp,
  paused: z.boolean(),
  busy: z.boolean(),
  currentPlaceId: Key.nullable(),
  places: z.array(SpacePlaceSchema),
  routes: z.array(SpaceRouteSchema),
  currentSceneId: Id.nullable(),
  canEstablish: z.boolean(),
});
export const TravelReceiptSchema = z.strictObject({
  status: z.literal('committed'),
  commandId: Id,
  worldId: Id,
  version: Version,
  sourceEventId: Id,
  routeId: Key,
  fromPlaceId: Key,
  toPlaceId: Key,
  fromLabel: z.string(),
  destinationLabel: z.string(),
  durationMinutes: z.number().int().positive(),
  departedAt: Timestamp,
  arrivedAt: Timestamp,
  leftSceneId: Id.nullable(),
});
export const TravelRecoverySchema = z.discriminatedUnion('status', [
  TravelReceiptSchema,
  z.strictObject({ status: z.literal('unconfirmed'), commandId: Id, worldId: Id }),
]);
export type WorldSpace = z.infer<typeof WorldSpaceSchema>;
export type TravelRequest = z.infer<typeof TravelRequestSchema>;
export type TravelReceipt = z.infer<typeof TravelReceiptSchema>;
export type TravelRecovery = z.infer<typeof TravelRecoverySchema>;
