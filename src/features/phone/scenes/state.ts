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
      return '行动已保存，后续结果还不能确认。请先核对原回应，不必再次发送行动。';
    case 'failed':
      return '这次现场回应没有完成，已保存的行动仍在。';
    case 'cancelled':
      return '这次回应已停止，行动记录仍在。';
    case 'conflict':
      return '现场已有变化，这次回应未能保存。行动记录仍在，可以重新读取。';
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

// Only the original entry command is retained; restoring never purchases a new response.
const SavedSceneEntry = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  destination: z.string().min(1).max(100),
});
export function restoreSceneEntry(raw: string | null, destination: string) {
  try {
    const value = SavedSceneEntry.safeParse(JSON.parse(raw ?? 'null'));
    return value.success && value.data.destination === destination ? value.data : undefined;
  } catch {
    return undefined;
  }
}
export function shouldResumeSceneTask(task: SceneTask | null | undefined, paused: boolean) {
  return task?.status === 'queued' && !paused;
}

/** Presence controls the responder, not whether a player can act in a live scene. */
export function sceneInputDisabled(
  read: SceneRead | undefined,
  task: SceneTask | null | undefined,
  submitting: boolean,
) {
  return (
    submitting || sceneBusy(task) || !read?.scene || read.paused || read.scene.status !== 'active'
  );
}

/** A slower read cannot replace a newer status of the same saved task. */
export function mergeSceneTask(current: SceneTask | null | undefined, next: SceneTask | null) {
  return current &&
    next &&
    current.id === next.id &&
    Date.parse(current.updatedAt) > Date.parse(next.updatedAt)
    ? current
    : next;
}

export function canRetrySceneTask(task: SceneTask | null | undefined) {
  return !!task && ['failed', 'unknown', 'cancelled'].includes(task.status);
}

/** Only query the original task here. Starting another paid response remains an explicit step. */
export async function readSceneTaskForRecovery(
  original: SceneTask,
  read: (id: string) => Promise<SceneTask>,
) {
  const latest = await read(original.id);
  if (
    latest.id !== original.id ||
    latest.scope.kind !== 'world' ||
    original.scope.kind !== 'world' ||
    latest.scope.worldId !== original.scope.worldId
  )
    throw new Error('现场回应的来源不一致，请重新读取现场。');
  return mergeSceneTask(original, latest)!;
}
