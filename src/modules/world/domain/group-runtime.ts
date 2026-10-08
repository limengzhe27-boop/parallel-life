import { DomainError } from './errors.ts';
import type { WorldState } from './types.ts';
import {
  assertGroupConversation,
  assertGroupMessage,
  groupMessagesForActor,
  canReadGroupMessage,
  type GroupConversation,
  type GroupMessage,
  type Participant,
  type ExperienceContext,
} from './experience-rules.ts';

export type GroupReply = {
  actorId: string;
  text: string;
  /** Assigned by runtime when building the event, never accepted from the model. */
  messageId?: string;
  invitation?: { title: string; at: string; id?: string };
};
export type GroupEvent = {
  schemaVersion: 1;
  id: string;
  ownerId: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
} & (
  | { type: 'group.created'; data: { groupId: string; title: string; actorIds: string[] } }
  | {
      type: 'group.membership_changed';
      data: { groupId: string; participant: Participant; action: 'join' | 'leave' };
    }
  | { type: 'group.message_sent'; data: { groupId: string; text: string; messageId?: string } }
  | { type: 'group.turn_resolved'; data: { groupId: string; replies: GroupReply[] } }
);
function invalid(): never {
  throw new DomainError('INVALID_COMMAND');
}
const same = (a: Participant, b: Participant) =>
  a.kind === b.kind && (a.kind === 'player' || (b.kind === 'actor' && a.actorId === b.actorId));
export function currentGroupMember(group: GroupConversation, p: Participant): boolean {
  return group.memberships.some((m) => same(m.participant, p) && m.leftVersion === undefined);
}
export function isGroupEvent(event: { type: string }): event is GroupEvent {
  return [
    'group.created',
    'group.membership_changed',
    'group.message_sent',
    'group.turn_resolved',
  ].includes(event.type);
}
/** Extension for the shared World reducer dispatcher: no parallel world state or clock. */
export function applyGroupWorldEvent(world: WorldState, event: GroupEvent): WorldState {
  if (event.ownerId !== world.ownerId || event.worldId !== world.id)
    throw new DomainError('NOT_FOUND');
  if (event.version !== world.version + 1) throw new DomainError('VERSION_CONFLICT');
  if (
    !Number.isFinite(Date.parse(event.storyAt)) ||
    Date.parse(event.storyAt) < Date.parse(world.time)
  )
    invalid();
  const invitations =
    event.type === 'group.turn_resolved'
      ? event.data.replies.flatMap((reply) =>
          reply.invitation
            ? [
                {
                  id: reply.invitation.id ?? event.id,
                  ...reply.invitation,
                  participantIds: [reply.actorId],
                  status: 'proposed' as const,
                  sourceEventId: event.id,
                },
              ]
            : [],
        )
      : [];
  return {
    ...world,
    version: event.version,
    time: event.storyAt,
    appointments: [...world.appointments, ...invitations],
  };
}
/** Projections are validated against the same committed event/version as the World write. */
export function reduceGroupEvent(
  context: ExperienceContext,
  previous: GroupConversation | undefined,
  event: GroupEvent,
): { group: GroupConversation; messages: GroupMessage[] } {
  if (event.ownerId !== context.world.ownerId || event.worldId !== context.world.id)
    throw new DomainError('NOT_FOUND');
  const source = {
    ownerId: event.ownerId,
    worldId: event.worldId,
    sourceEventId: event.id,
    sourceVersion: event.version,
  };
  let group: GroupConversation;
  const messages: GroupMessage[] = [];
  if (event.type === 'group.created') {
    if (
      previous ||
      !event.data.title.trim() ||
      event.data.title.length > 120 ||
      event.data.actorIds.length < 1 ||
      event.data.actorIds.length > 20 ||
      new Set(event.data.actorIds).size !== event.data.actorIds.length
    )
      invalid();
    group = {
      ...source,
      id: event.data.groupId,
      title: event.data.title,
      memberships: [
        {
          participant: { kind: 'player' },
          joinedVersion: event.version,
          sourceEventId: event.id,
          sourceVersion: event.version,
        },
        ...event.data.actorIds.map((actorId) => ({
          participant: { kind: 'actor' as const, actorId },
          joinedVersion: event.version,
          sourceEventId: event.id,
          sourceVersion: event.version,
        })),
      ],
    };
  } else {
    if (!previous || previous.id !== event.data.groupId) throw new DomainError('NOT_FOUND');
    group = structuredClone(previous);
    if (event.type === 'group.membership_changed') {
      const p = event.data.participant;
      // Only the owner may restore their own membership after leaving; they
      // cannot manage NPC membership in an absent player's group.
      if (p.kind !== 'player' && !currentGroupMember(group, { kind: 'player' })) invalid();
      const active = group.memberships.find(
        (m) => same(m.participant, p) && m.leftVersion === undefined,
      );
      if (event.data.action === 'join') {
        if (active) invalid();
        group.memberships.push({
          participant: p,
          joinedVersion: event.version,
          sourceEventId: event.id,
          sourceVersion: event.version,
        });
      } else {
        if (!active || active.joinedVersion >= event.version) invalid();
        active.leftVersion = event.version;
      }
    } else {
      if (!currentGroupMember(group, { kind: 'player' })) invalid();
      const send = (sender: Participant, text: string, messageId: string) => {
        if (!text.trim() || text.length > (sender.kind === 'player' ? 4000 : 500)) invalid();
        messages.push({
          ...source,
          id: messageId,
          conversationId: group.id,
          sender,
          text,
          media: [],
        });
      };
      if (event.type === 'group.message_sent')
        send({ kind: 'player' }, event.data.text, event.data.messageId ?? event.id);
      else {
        if (
          event.data.replies.length > 2 ||
          new Set(event.data.replies.map((r) => r.actorId)).size !== event.data.replies.length
        )
          invalid();
        for (const reply of event.data.replies) {
          send({ kind: 'actor', actorId: reply.actorId }, reply.text, reply.messageId ?? event.id);
          if (
            reply.invitation &&
            (!reply.invitation.title.trim() ||
              reply.invitation.title.length > 120 ||
              !Number.isFinite(Date.parse(reply.invitation.at)) ||
              !/Z$|[+-]\d\d:\d\d$/u.test(reply.invitation.at) ||
              Date.parse(reply.invitation.at) <= Date.parse(event.storyAt))
          )
            throw new DomainError(
              'INVALID_COMMAND',
              'Group invitation must name a future story instant',
            );
        }
      }
    }
  }
  // Keep persisted projections readable by the existing PLAY contract.
  if (group.memberships.length > 1000) invalid();
  assertGroupConversation(context, group);
  for (const message of messages) assertGroupMessage(context, group, message);
  return { group, messages };
}
/** Identical membership boundaries for the player UI and the NPC model. */
export function groupHistory(
  context: ExperienceContext,
  group: GroupConversation,
  messages: GroupMessage[],
  reader: Participant,
): GroupMessage[] {
  return reader.kind === 'actor'
    ? groupMessagesForActor(context, group, messages, reader.actorId)
    : messages.filter((m) => canReadGroupMessage(context, group, m, reader));
}
/** Cost/noise policy, not a fixed cast order or a command to make everyone answer. */
export function selectGroupSpeakers(
  world: WorldState,
  group: GroupConversation,
  text: string,
  maxReplies = 1,
): string[] {
  if (!currentGroupMember(group, { kind: 'player' })) return [];
  if (/^(?:晚安|先这样|不用回复|我先走了)[。！!\s]*$/u.test(text.trim())) return [];
  const actors = world.actors.filter((a) =>
    currentGroupMember(group, { kind: 'actor', actorId: a.id }),
  );
  const tokens = text.toLowerCase().match(/[a-z0-9]{2,}|[\p{Script=Han}]{2,}/gu) ?? [];
  const terms = tokens.flatMap((part) =>
    /^[\p{Script=Han}]+$/u.test(part)
      ? Array.from({ length: part.length - 1 }, (_, i) => part.slice(i, i + 2))
      : [part],
  );
  const ranked = actors
    .map((a, index) => {
      const explicit =
        text.includes(`@${a.id}`) ||
        (actors.filter((b) => b.name === a.name).length === 1 && text.includes(`@${a.name}`));
      const relevant = terms.filter((t) =>
        `${a.persona} ${a.relationship ?? ''}`.toLowerCase().includes(t),
      ).length;
      return { actorId: a.id, score: (explicit ? 100 : 0) + relevant, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const limit = Number.isFinite(maxReplies) ? Math.max(1, Math.min(2, Math.floor(maxReplies))) : 1;
  return ranked
    .filter((a, i) => i === 0 || a.score >= 2)
    .slice(0, limit)
    .map((a) => a.actorId);
}
