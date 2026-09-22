import { z } from 'zod';
import { Id, Version, Timestamp, FactCategory, TaskSchema } from './api.ts';

export const BasisSchema = z.strictObject({
  factId: Id,
  category: FactCategory,
  value: z.string().min(1).max(500),
});
export const DirectionFields = z.strictObject({
  title: z.string().trim().min(1).max(60),
  premise: z.string().trim().min(1).max(300),
  opening: z.string().trim().min(1).max(400),
  tradeoff: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(300),
});
export const LifeDirectionSchema = DirectionFields.extend({
  id: Id,
  sources: z.array(BasisSchema).max(6),
});
export type LifeDirection = z.infer<typeof LifeDirectionSchema>;
export const DiscoverySchema = z.strictObject({
  profileId: Id,
  version: Version,
  profileVersion: Version,
  brief: z.string().max(1500),
  directions: z.array(LifeDirectionSchema).max(3),
  updatedAt: Timestamp.nullable(),
  activeTask: TaskSchema.nullable(),
});
export type Discovery = z.infer<typeof DiscoverySchema>;
export const DiscoverRequestSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  expectedProfileVersion: Version,
  brief: z.string().trim().max(1500).default(''),
  basedOnId: Id.nullable().default(null),
});
export type DiscoverRequest = z.infer<typeof DiscoverRequestSchema>;
export const DiscoveryInputSchema = z.strictObject({
  kind: z.literal('discovery'),
  profileId: Id,
  expectedVersion: Version,
  profileVersion: Version,
  basis: z.array(BasisSchema).max(24),
  brief: z.string().max(1500),
  basedOn: LifeDirectionSchema.nullable(),
});
export type DiscoveryInput = z.infer<typeof DiscoveryInputSchema>;
