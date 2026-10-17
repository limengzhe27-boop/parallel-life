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
