import { z } from 'zod';
import { Id, Version } from '../../../contracts/api.ts';
import type { GroupConversation, Participant } from '../../../contracts/world-experiences.ts';
import type { PhoneContact } from '../apps/types.ts';
import type { GroupDetail, GroupTask } from './client.ts';
export function groupTarget(id: string) {
  return 'group:' + Id.parse(id);
}
export function parseGroupTarget(target?: string): string | undefined {
  if (!target?.startsWith('group:')) return;
  const parsed = Id.safeParse(target.slice(6));
  return parsed.success ? parsed.data : undefined;
}
export function activeMembers(group: GroupConversation): Participant[] {
  return group.memberships.filter((m) => m.leftVersion === undefined).map((m) => m.participant);
}
export function isJoined(group: GroupConversation) {
  return activeMembers(group).some((p) => p.kind === 'player');
}
export function publicMemberName(p: Participant, contacts: readonly PhoneContact[]) {
  return p.kind === 'player' ? '我' : (contacts.find((c) => c.id === p.actorId)?.name ?? '群成员');
}
export function groupPreview(detail: GroupDetail, contacts: readonly PhoneContact[]) {
  const latest = detail.messages.at(-1);
  return latest ? publicMemberName(latest.sender, contacts) + '：' + latest.text : '还没有消息';
}
export function taskText(task?: GroupTask) {
  switch (task?.status) {
    case 'queued':
      return '已发送，等待回复';
    case 'running':
      return '已发送，正在等大家回复';
    case 'failed':
      return '这次没收到回复，已发送的消息还在。';
    case 'unknown':
      return '回复结果还不能确认，请先查看最新消息。';
    case 'cancelled':
      return '这次回复已停止，消息还在。';
    default:
      return '';
  }
}
export function mayExecute(task: GroupTask) {
  return task.status === 'queued';
}
export function mayRetry(task: GroupTask) {
  return ['failed', 'unknown', 'cancelled'].includes(task.status);
}
/** Reconciliation data, not a second message store. No speculative NPC messages. */
export const PendingSchema = z.strictObject({
  worldId: Id,
  groupId: Id,
  commandId: Id,
  expectedVersion: Version,
  text: z.string().min(1).max(4000),
  taskId: Id.optional(),
  retryCommandId: Id.optional(),
});
export type Pending = z.infer<typeof PendingSchema>;
export function restorePending(
  raw: string | null,
  worldId: string,
  groupId: string,
): Pending | undefined {
  if (!raw) return;
  try {
    const p = PendingSchema.safeParse(JSON.parse(raw));
    if (p.success && p.data.worldId === worldId && p.data.groupId === groupId) return p.data;
  } catch {
    /* Corrupt local drafts never become server commands. */
  }
}
export function localGroupKey(
  worldId: string,
  groupId: string,
  kind: 'draft' | 'pending' | 'scroll',
) {
  return `pl-group:${worldId}:${groupId}:${kind}`;
}

/** Ignore late query results without rolling back either history or the read receipt. */
export function mergeGroupDetail(
  current: GroupDetail | undefined,
  incoming: GroupDetail,
): GroupDetail {
  if (!current) return incoming;
  if (current.version > incoming.version) return current;
  const lastReadVersion = Math.max(current.lastReadVersion, incoming.lastReadVersion);
  return {
    ...incoming,
    lastReadVersion,
    unread: incoming.messages.filter(
      (m) => m.sender.kind === 'actor' && m.sourceVersion > lastReadVersion,
    ).length,
  };
}
