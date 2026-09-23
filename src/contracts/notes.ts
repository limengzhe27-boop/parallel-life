import { z } from 'zod';
import { Id, Timestamp } from './api.ts';
/** Opening notes use a world-scoped synthetic id, so ':' is allowed here. */
const NoteId = z.string().regex(/^[a-zA-Z0-9_:-]{1,140}$/);
export const NoteSaveRequestSchema = z.strictObject({
  commandId: Id,
  /** Absent for a brand-new note; present to update one (including an opening note). */
  id: NoteId.optional(),
  title: z.string().trim().min(1).max(80),
  text: z.string().max(2000).default(''),
  /** The note's own version: 0 when it is not persisted yet. */
  expectedVersion: z.number().int().nonnegative(),
});
export type NoteSaveRequest = z.input<typeof NoteSaveRequestSchema>;
export const NoteSchema = z.strictObject({
  id: NoteId,
  title: z.string().min(1).max(80),
  text: z.string().max(2000),
  version: z.number().int().nonnegative(),
  updatedAt: Timestamp,
});
export type Note = z.infer<typeof NoteSchema>;
export const NoteReceiptSchema = z.strictObject({
  status: z.literal('committed'),
  commandId: Id,
  worldId: Id,
  version: z.number().int().nonnegative(),
  note: NoteSchema,
});
export type NoteReceipt = z.infer<typeof NoteReceiptSchema>;
