import { z } from 'zod';
import { Id, Timestamp } from './api.ts';
export const AlbumUploadSchema = z.strictObject({
  commandId: Id,
  title: z.string().trim().min(1).max(80),
});
export const AlbumPhotoSchema = z.strictObject({
  id: Id,
  worldId: Id,
  title: z.string().min(1).max(80),
  date: Timestamp,
  createdAt: Timestamp,
  kind: z.enum(['upload', 'generated']),
  sourcePersonId: Id.optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  revision: z.number().int().positive(),
});
export type AlbumPhoto = z.infer<typeof AlbumPhotoSchema>;
