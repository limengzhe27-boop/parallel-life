import { z } from 'zod';
import { Id } from './api.ts';

export const OfficialLifeIdSchema = z.enum([
  'county-yellow-hair',
  'only-child',
  'returned-daughter',
  'retired-star',
]);
export type OfficialLifeId = z.infer<typeof OfficialLifeIdSchema>;
export const OfficialLifeCardSchema = z.strictObject({
  id: OfficialLifeIdSchema,
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(80),
  hook: z.string().trim().min(1).max(180),
  identityLabel: z.string().trim().min(1).max(80),
  experienceNote: z.string().trim().min(1).max(240),
  worldId: Id.nullable(),
  hasNewVersion: z.boolean().default(false),
  legacyWorldId: Id.nullable().default(null),
  currentVersionWorldId: Id.nullable().default(null),
});
export type OfficialLifeCard = z.infer<typeof OfficialLifeCardSchema>;
export const OfficialLifeListSchema = z.strictObject({
  lives: z.array(OfficialLifeCardSchema).max(4),
});
export type OfficialLifeList = z.infer<typeof OfficialLifeListSchema>;
export const OfficialLifeStartRequestSchema = z.strictObject({
  commandId: Id,
  version: z.number().int().positive(),
});
export type OfficialLifeStartRequest = z.infer<typeof OfficialLifeStartRequestSchema>;
export const OfficialLifeStartResultSchema = z.strictObject({
  presetId: OfficialLifeIdSchema,
  version: z.number().int().positive(),
  worldId: Id,
  seedId: Id,
  resumed: z.boolean(),
});
export type OfficialLifeStartResult = z.infer<typeof OfficialLifeStartResultSchema>;
