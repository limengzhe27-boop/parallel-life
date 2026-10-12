import { z } from 'zod';
import { Id, Version, Timestamp } from './api.ts';
import type {
  AppointmentWaitEvent,
  AppointmentWaitReceipt,
} from '../modules/world/domain/appointment-wait.ts';
const invitationId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const placeId = z.string().regex(/^[a-z0-9_]{1,64}$/);
export const AppointmentWaitRequestSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  invitationId,
});
export type AppointmentWaitRequest = z.infer<typeof AppointmentWaitRequestSchema>;
export const AppointmentWaitReceiptSchema = z.strictObject({
  status: z.literal('committed'),
  commandId: Id,
  worldId: Id,
  version: Version.min(1),
  sourceEventId: Id,
  invitationId,
  placeId,
  fromStoryAt: Timestamp,
  storyNow: Timestamp,
  waitedMinutes: z.number().finite().positive(),
}) satisfies z.ZodType<AppointmentWaitReceipt>;
export const AppointmentWaitEventSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    type: z.literal('appointment.waited'),
    id: Id,
    worldId: Id,
    commandId: Id,
    version: Version.min(1),
    occurredAt: Timestamp,
    storyAt: Timestamp,
    data: z.strictObject({
      invitationId,
      invitationResponseVersion: Version.nullable(),
      placeId,
      fromStoryAt: Timestamp,
      toStoryAt: Timestamp,
    }),
  })
  .refine(
    (e) => e.storyAt === e.data.toStoryAt && Date.parse(e.storyAt) > Date.parse(e.data.fromStoryAt),
    'Wait source and target must match',
  ) satisfies z.ZodType<AppointmentWaitEvent>;
export type AppointmentWaitPhoneActions = {
  waitToAppointment?: (invitationId: string, commandId: string) => Promise<AppointmentWaitReceipt>;
  canWaitToAppointment?: (invitationId: string) => boolean;
};
