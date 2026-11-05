import type { WorldMoment, WorldState } from './types.ts';

export type PlayerSocialChange =
  | { kind: 'publish'; text: string; audienceActorIds?: string[] }
  | { kind: 'like'; momentKey: string }
  | { kind: 'like_message'; messageId: string };

export type PlayerSocialEvent = {
  schemaVersion: 1;
  type: 'social.updated';
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyTime: string;
  data: PlayerSocialChange;
};

export function actorCanSeeMoment(moment: WorldMoment, actorId: string, storyAt: string) {
  return (
    Date.parse(moment.at) <= Date.parse(storyAt) &&
    (moment.actorId === actorId ||
      moment.audienceActorIds === undefined ||
      moment.audienceActorIds.includes(actorId))
  );
}

export function applyPlayerSocialEvent(current: WorldState, event: PlayerSocialEvent): WorldState {
  const next = { ...current, version: event.version, time: event.storyTime };
  const change = event.data;
  if (change.kind === 'publish') {
    next.moments = [
      ...(current.moments ?? []),
      {
        id: event.id,
        key: event.id.replaceAll('-', ''),
        actorId: 'player',
        name: '我',
        text: change.text,
        at: event.storyTime,
        ...(change.audienceActorIds === undefined
          ? {}
          : { audienceActorIds: change.audienceActorIds }),
        sourceEventId: event.id,
      },
    ];
  } else if (change.kind === 'like_message') {
    next.likedMessageIds = [...(current.likedMessageIds ?? []), change.messageId];
  } else {
    next.momentInteractions = [
      ...(current.momentInteractions ?? []),
      {
        id: event.id,
        momentKey: change.momentKey,
        actorId: 'player',
        kind: 'like',
        at: event.storyTime,
        sourceEventId: event.id,
      },
    ];
  }
  return next;
}
