import type { SceneRead } from '../../../contracts/scenes.ts';
import { z } from 'zod';
import { Id, Version, TaskSchema } from '../../../contracts/api.ts';
export type SceneTask = z.infer<typeof TaskSchema>;
export function sceneBusy(task?: SceneTask | null) {
  return Boolean(task && ['queued', 'running'].includes(task.status));
}
export function sceneStatus(task?: SceneTask | null) {
  switch (task?.status) {
    case 'queued':
      return '行动已保存，等待现场回应';
    case 'running':
      return '行动已保存，正在等待现场回应';
    case 'unknown':
      return '结果还不能确认，请先重新读取。确认重试可能再次产生费用。';
    case 'failed':
      return '这次现场回应没有完成，已保存的行动仍在。';
    case 'cancelled':
      return '这次回应已停止，行动记录仍在。';
    default:
      return '';
  }
}
export function mergeScene(current: SceneRead | undefined, next: SceneRead) {
  return current && current.scene?.id === next.scene?.id && current.worldVersion > next.worldVersion
    ? current
    : next;
}

export const SavedSceneCommand = z.strictObject({
  id: Id,
  version: Version,
  text: z.string().min(1).max(4000),
  relatedMatterIds: z.array(Id).max(8).optional(),
});
export function restoreSceneCommand(raw: string | null) {
  try {
    const p = SavedSceneCommand.safeParse(JSON.parse(raw ?? 'null'));
    return p.success ? p.data : undefined;
  } catch {
    return undefined;
  }
}
