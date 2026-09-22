import { z } from 'zod';
import { Id, Timestamp } from './api.ts';
const AppointmentId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const base = { commandId: Id, id: AppointmentId, expectedVersion: z.number().int().nonnegative() };
export const InvitationRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...base, operation: z.literal('accept') }),
  z.strictObject({ ...base, operation: z.literal('cancel') }),
  z.strictObject({
    ...base,
    operation: z.literal('reschedule'),
    at: z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString()),
  }),
]);
export type InvitationRequest = z.input<typeof InvitationRequestSchema>;
export const InvitationSchema = z.strictObject({
  id: AppointmentId,
  title: z.string(),
  at: Timestamp,
  participantIds: z.array(z.string()),
  status: z.enum(['proposed', 'confirmed', 'cancelled']),
});
export const InvitationReceiptSchema = z.strictObject({
  status: z.literal('committed'),
  commandId: Id,
  worldId: Id,
  version: z.number().int().nonnegative(),
  invitation: InvitationSchema,
});
