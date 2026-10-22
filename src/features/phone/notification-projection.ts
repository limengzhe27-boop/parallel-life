import {
  isIncomingRuntimeMessage,
  type MessageNotificationState,
} from './message-notification-policy.ts';
import type { PhoneNotification } from './phone-shell.tsx';
import { STICKER_LABELS, type StickerId } from './stickers.ts';
import { isGenericProactiveLine } from '../../modules/world/domain/proactive-quality.ts';

type Message = MessageNotificationState & {
  id: string;
  actorId: string;
  text: string;
  stickerId?: string;
  at: string;
  photoId?: string;
  mediaType?: string;
  photo?: { mediaType?: string };
  attachment?: { kind: string };
};
type Contact = { id: string; name: string };
type LockInvitation = {
  id: string;
  title: string;
  at: string;
  status: 'proposed' | 'confirmed' | 'cancelled' | 'attended' | 'missed';
};

/**
 * Lock-screen projection. The phone keeps every unread item for the app lists, but
 * the lock shows at most three high-stakes items. Calendar consequences outrank
 * undifferentiated chat; one actor cannot fill all three slots with a burst.
 * Returns a new array and never mutates or invents a message.
 */
export const LOCK_SCREEN_LIMIT = 3;
export function lockScreenNotifications(
  notifications: readonly PhoneNotification[],
  invitations: readonly LockInvitation[],
  referenceTime: string | undefined,
  timeLabel: (at: string) => string,
  limit = LOCK_SCREEN_LIMIT,
): PhoneNotification[] {
  const now = referenceTime ? Date.parse(referenceTime) : Number.NaN;
  if (!Number.isFinite(now) || limit <= 0) return notifications.slice(0, Math.max(0, limit));
  const cards: PhoneNotification[] = [];
  const rank = new Map<string, number>();
  const represented = new Set<string>();
  for (const invitation of invitations) {
    const at = Date.parse(invitation.at);
    if (!Number.isFinite(at)) continue;
    let title = '',
      summary = '',
      priority = 0;
    if (invitation.status === 'confirmed' && at <= now && at >= now - 12 * 60 * 60_000) {
      const overdue = now >= at + 60 * 60_000;
      title = overdue ? '约定时间已过' : '约定时间到了';
      summary = `${invitation.title} · ${overdue ? '还没有结果记录' : '还没有到场记录'}`;
      priority = overdue ? 1 : 2;
    } else if (invitation.status === 'confirmed' && at > now && at - now <= 2 * 60 * 60_000) {
      title = '约定快到了';
      summary = `${invitation.title} · 记得确认出发安排`;
      priority = 3;
    } else if (invitation.status === 'proposed' && at > now) {
      title = '邀约待回复';
      summary = `${invitation.title} · 还没有替你答应`;
      priority = 4;
    }
    if (!priority) continue;
    represented.add(invitation.id);
    const id = `lock-appointment:${invitation.id}`;
    rank.set(id, priority);
    cards.push({
      id,
      title,
      summary,
      app: 'calendar',
      target: invitation.id,
      at: invitation.at,
      timeLabel: timeLabel(invitation.at),
      actionableUntil: invitation.at,
    });
  }
  // High-stakes calendar moments first; within a class the oldest unresolved moment
  // is the most urgent. Chat then follows newest-first, one item per destination.
  cards.sort(
    (a, b) =>
      (rank.get(a.id) ?? 9) - (rank.get(b.id) ?? 9) ||
      Date.parse(a.at ?? '') - Date.parse(b.at ?? ''),
  );
  const result: PhoneNotification[] = [];
  const destinations = new Set<string>();
  const push = (item: PhoneNotification) => {
    if (result.length >= limit) return;
    const key = item.target ? `${item.app}:${item.target}` : `id:${item.id}`;
    if (destinations.has(key)) return;
    destinations.add(key);
    result.push(item);
  };
  for (const card of cards) push(card);
  const chat = notifications
    .filter((item) => !(item.app === 'calendar' && item.target && represented.has(item.target)))
    // A lock screen is for a reason to return, not a transcript of waiting noises.
    .filter((item) => !isGenericProactiveLine(item.summary))
    .sort((a, b) => Date.parse(b.at ?? '') - Date.parse(a.at ?? ''));
  for (const item of chat) push(item);
  return result;
}

/** Keep every authorized, unread, persisted message. Presentation limits belong to the lock screen. */
export function projectMessageNotifications(
  messages: readonly Message[],
  contacts: readonly Contact[],
  viewed: ReadonlySet<string>,
  timeLabel: (at: string) => string,
): PhoneNotification[] {
  const names = new Map(contacts.map((contact) => [contact.id, contact.name]));
  const seen = new Set<string>();
  return messages
    .filter((message) => {
      if (!isIncomingRuntimeMessage(message) || viewed.has(message.id) || seen.has(message.id))
        return false;
      seen.add(message.id);
      return true;
    })
    .map((message) => ({
      id: message.id,
      title: names.get(message.actorId) ?? '微信消息',
      summary:
        message.text ||
        (message.stickerId
          ? `[${STICKER_LABELS[message.stickerId as StickerId] ?? '表情'}]`
          : message.mediaType === 'video' ||
              message.photo?.mediaType === 'video' ||
              message.attachment?.kind === 'video'
            ? '[视频]'
            : message.photoId || message.photo || message.attachment?.kind === 'image'
              ? '[图片]'
              : ''),
      app: 'messages' as const,
      conversationKind: 'private' as const,
      target: message.actorId,
      at: message.at,
      timeLabel: timeLabel(message.at),
    }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export type NotificationGroup = {
  key: string;
  app: PhoneNotification['app'];
  conversationKind: NonNullable<PhoneNotification['conversationKind']> | 'single';
  target?: string;
  /** Oldest first when expanded. */
  items: PhoneNotification[];
  latest: PhoneNotification;
  actionable: boolean;
};

function timestamp(value?: string): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** A newly appended item wins an equal or absent timestamp, so one group can still alert again. */
export function latestNotification(
  items: readonly PhoneNotification[],
): PhoneNotification | undefined {
  return items.reduce<PhoneNotification | undefined>(
    (latest, item) => (!latest || timestamp(item.at) >= timestamp(latest.at) ? item : latest),
    undefined,
  );
}

/** Group by stable destination, never by display name. Items without a target remain separate. */
export function groupNotifications(
  notifications: readonly PhoneNotification[],
  referenceTime?: string,
): NotificationGroup[] {
  const groups = new Map<string, PhoneNotification[]>();
  const seen = new Set<string>();
  for (const notification of notifications) {
    const identity = JSON.stringify([notification.app, notification.id]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const kind =
      notification.conversationKind ?? (notification.app === 'messages' ? 'private' : 'single');
    const key = JSON.stringify([
      notification.app,
      kind,
      notification.target ? 'target' : 'item',
      notification.target || notification.id,
    ]);
    const items = groups.get(key) ?? [];
    items.push(notification);
    groups.set(key, items);
  }
  const now = timestamp(referenceTime);
  return [...groups]
    .map(([key, items]): NotificationGroup => {
      items.sort((a, b) => {
        const difference = timestamp(a.at) - timestamp(b.at);
        return Number.isNaN(difference) ? 0 : difference;
      });
      const latest = items.at(-1)!;
      return {
        key,
        app: latest.app,
        conversationKind:
          latest.conversationKind ?? (latest.app === 'messages' ? 'private' : 'single'),
        ...(latest.target ? { target: latest.target } : {}),
        items,
        latest,
        actionable:
          Number.isFinite(now) &&
          now !== Number.NEGATIVE_INFINITY &&
          items.some((item) => timestamp(item.actionableUntil) > now),
      };
    })
    .sort((a, b) => {
      if (a.actionable !== b.actionable) return Number(b.actionable) - Number(a.actionable);
      const difference = timestamp(b.latest.at) - timestamp(a.latest.at);
      return Number.isNaN(difference) ? 0 : difference;
    });
}
