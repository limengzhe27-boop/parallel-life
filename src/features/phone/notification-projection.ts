import type { PhoneNotification } from './phone-shell.tsx';

type Message = {
  id: string;
  actorId: string;
  role?: 'user' | 'assistant';
  initialRead?: boolean;
  text: string;
  at: string;
};
type Contact = { id: string; name: string };

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
      if (
        message.role === 'user' ||
        message.initialRead === true ||
        viewed.has(message.id) ||
        seen.has(message.id)
      )
        return false;
      seen.add(message.id);
      return true;
    })
    .map((message) => ({
      id: message.id,
      title: names.get(message.actorId) ?? '微信消息',
      summary: message.text,
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
