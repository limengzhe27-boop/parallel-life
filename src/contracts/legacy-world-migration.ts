import { z } from 'zod';

export const LegacyActorInventoryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  hasPersona: z.boolean(),
});
export type LegacyActorInventoryItem = z.infer<typeof LegacyActorInventoryItemSchema>;

export const LegacyWorldInventorySchema = z.object({
  worldId: z.string(),
  version: z.number().int().nonnegative(),
  engineEpoch: z.number().int().min(1),
  actorCount: z.number().int().nonnegative(),
  actors: z.array(LegacyActorInventoryItemSchema),
  messageCount: z.number().int().nonnegative(),
  appointmentCount: z.number().int().nonnegative(),
  openAppointmentsCount: z.number().int().nonnegative(),
  placeCount: z.number().int().nonnegative(),
  noteCount: z.number().int().nonnegative(),
  time: z.unknown(),
  isEligibleForMigration: z.boolean(),
  blockers: z.array(z.string()),
});
export type LegacyWorldInventory = z.infer<typeof LegacyWorldInventorySchema>;

export const LegacyMigrationRequestSchema = z.object({
  expectedWorldVersion: z.number().int().nonnegative().optional(),
  actorDefinitionRefs: z.record(z.string(), z.string()).optional(),
});
export type LegacyMigrationRequest = z.infer<typeof LegacyMigrationRequestSchema>;

export const LegacyMigrationResponseSchema = z.object({
  worldId: z.string(),
  success: z.boolean(),
  alreadyMigrated: z.boolean(),
  engineEpoch: z.number().int(),
  worldVersion: z.number().int(),
  actorCount: z.number().int(),
  migratedResponsibilitiesCount: z.number().int(),
});
export type LegacyMigrationResponse = z.infer<typeof LegacyMigrationResponseSchema>;
