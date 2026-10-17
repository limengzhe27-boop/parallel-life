import { z } from 'zod';

export const WorldLifecycleStatusSchema = z.enum(['active', 'archived', 'deleted']);
export type WorldLifecycleStatus = z.infer<typeof WorldLifecycleStatusSchema>;

export const WorldListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  storyTime: z.string().optional(),
  status: WorldLifecycleStatusSchema,
  archivedAt: z.string().nullable().optional(),
  actorCount: z.number().int(),
  previewText: z.string().optional(),
  sourceKind: z.enum(['custom', 'official', 'published', 'unknown']).optional(),
  wallpaperUrl: z.string().optional(),
  parentWorldId: z.string().nullable().optional(),
  forkVersion: z.number().int().nullable().optional(),
});
export type WorldListItem = z.infer<typeof WorldListItemSchema>;

export const WorldListResponseSchema = z.object({
  worlds: z.array(WorldListItemSchema),
});
export type WorldListResponse = z.infer<typeof WorldListResponseSchema>;

export const WorldPatchRequestSchema = z
  .object({
    title: z.string().trim().min(1, '标题不能为空').max(60, '标题不能超过60字').optional(),
    action: z.enum(['archive', 'restore']).optional(),
  })
  .refine((data) => data.title !== undefined || data.action !== undefined, {
    message: '必须提供修改的标题或执行的动作',
  });
export type WorldPatchRequest = z.infer<typeof WorldPatchRequestSchema>;

export const WorldForkRequestSchema = z.object({
  forkVersion: z.number().int().min(0, '分叉版本必须非负'),
  title: z.string().trim().min(1, '标题不能为空').max(60, '标题不能超过60字').optional(),
});
export type WorldForkRequest = z.infer<typeof WorldForkRequestSchema>;

export const WorldForkResponseSchema = z.object({
  world: z.object({
    id: z.string().uuid(),
    parentWorldId: z.string(),
    forkVersion: z.number().int(),
    title: z.string(),
    version: z.number().int(),
    status: WorldLifecycleStatusSchema,
    storyTime: z.string().optional(),
    createdAt: z.string(),
  }),
});
export type WorldForkResponse = z.infer<typeof WorldForkResponseSchema>;

export const WorldForkCheckpointSchema = z.object({
  version: z.number().int(),
  occurredAt: z.string(),
  storyTime: z.string().optional(),
  summary: z.string(),
});
export type WorldForkCheckpoint = z.infer<typeof WorldForkCheckpointSchema>;

export const WorldForkCheckpointsResponseSchema = z.object({
  worldId: z.string(),
  currentVersion: z.number().int(),
  title: z.string(),
  checkpoints: z.array(WorldForkCheckpointSchema),
});
export type WorldForkCheckpointsResponse = z.infer<typeof WorldForkCheckpointsResponseSchema>;
