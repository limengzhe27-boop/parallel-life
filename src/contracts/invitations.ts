import { GenesisSourceSchema } from './world-records.ts';
import { z } from 'zod';
import { Id, Timestamp } from './api.ts';
const AppointmentId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const base = { commandId: Id, id: AppointmentId, expectedVersion: z.number().int().nonnegative() };
export const InvitationRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...base, operation: z.literal('accept') }),
  z.strictObject({ ...base, operation: z.literal('cancel') }),
  z.strictObject({ ...base, operation: z.literal('attend') }),
  z.strictObject({ ...base, operation: z.literal('miss') }),
  z.strictObject({
    ...base,
    operation: z.literal('reschedule'),
    at: z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString()),
  }),
]);
export const InvitationAppSchema = z.enum([
  'map',
  'photos',
  'calendar',
  'messages',
  'notes',
  'scenes',
  'moments',
  'records',
]);
export const InvitationLinkSchema = z.strictObject({
  app: InvitationAppSchema,
  target: z.string().min(1).max(200),
  label: z.string().min(1).max(100),
});
export const InvitationSchema = z.strictObject({
  origin: GenesisSourceSchema.optional(),
  id: AppointmentId,
  title: z.string(),
  at: Timestamp,
  participantIds: z.array(z.string()),
  status: z.enum(['proposed', 'confirmed', 'cancelled', 'attended', 'missed']),
  responseAt: Timestamp.optional(),
  responseVersion: z.number().int().nonnegative().optional(),
  links: z.array(InvitationLinkSchema).optional(),
});
export const InvitationReceiptSchema = z.strictObject({
  status: z.literal('committed'),
  commandId: Id,
  worldId: Id,
  version: z.number().int().nonnegative(),
  invitation: InvitationSchema,
});
