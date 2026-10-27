import type { SceneSession } from './experience-rules.ts';
import type { AgentArrivalCommittedEvent } from './agent-arrival-event.ts';
import type { AuthoritativePosition } from './world-awareness.ts';
import { DomainError } from './errors.ts';

/** Join an already open, player-occupied scene only after an actual journey arrives.
 * A place name, calendar roster, NPC statement or unknown position cannot establish presence.
 */
export function applyAgentSceneArrival(
  scene: SceneSession,
  input: {
    ownerId: string;
    event: AgentArrivalCommittedEvent;
    playerPosition: AuthoritativePosition | null;
  },
): SceneSession {
  const { event, playerPosition: player } = input;
  const { arrival, route, actorId } = event.data;
  if (
    scene.worldId !== event.worldId ||
    scene.ownerId !== input.ownerId ||
    !event.id ||
    !Number.isSafeInteger(event.version) ||
    event.version < 1 ||
    arrival.worldId !== event.worldId ||
    arrival.actorId !== actorId ||
    arrival.eventId !== event.id ||
    arrival.commandId !== event.commandId ||
    arrival.worldVersion !== event.version ||
    arrival.journeyId !== event.data.journeyId ||
    arrival.at !== event.storyAt ||
    !Number.isFinite(Date.parse(event.storyAt))
  )
    throw new DomainError('INVALID_PROPOSAL', 'INVALID_AGENT_SCENE_ARRIVAL');
  return applyAgentScenePosition(scene, {
    ownerId: input.ownerId,
    playerPosition: player,
    position: {
      worldId: event.worldId,
      subject: { kind: 'actor', actorId },
      status: 'at',
      placeId: route.toPlaceId,
      sourceEventId: event.id,
      worldVersion: event.version,
      occurredAt: event.storyAt,
    },
  });
}
/** Only called for an already validated current position commit, including the
 * one-time unset fictional position. It records current presence, never a trip
 * or a claim that the actor was here before this position was established. */
export function applyAgentScenePosition(
  scene: SceneSession,
  input: {
    ownerId: string;
    position: AuthoritativePosition;
    playerPosition: AuthoritativePosition | null;
  },
): SceneSession {
  const { position, playerPosition: player } = input;
  if (
    scene.worldId !== position.worldId ||
    scene.ownerId !== input.ownerId ||
    position.subject.kind !== 'actor' ||
    !position.subject.actorId ||
    position.status !== 'at' ||
    !position.placeId ||
    !position.sourceEventId ||
    !Number.isSafeInteger(position.worldVersion) ||
    position.worldVersion < 1 ||
    !Number.isFinite(Date.parse(position.occurredAt))
  )
    throw new DomainError('INVALID_PROPOSAL', 'INVALID_AGENT_SCENE_POSITION');
  const actorId = position.subject.actorId;
  const alreadyJoined = scene.presence.find(
    (p) =>
      p.participant.kind === 'actor' &&
      p.participant.actorId === actorId &&
      p.joinedVersion === position.worldVersion &&
      p.sourceVersion === position.worldVersion &&
      p.sourceEventId === position.sourceEventId!,
  );
  // Replaying the same committed arrival preserves every later interval unchanged.
  if (alreadyJoined) return scene;
  if (
    scene.status !== 'active' ||
    scene.placeId !== position.placeId ||
    scene.sourceVersion >= position.worldVersion ||
    !player ||
    player.worldId !== position.worldId ||
    player.subject.kind !== 'player' ||
    player.status !== 'at' ||
    player.placeId !== position.placeId ||
    player.worldVersion >= position.worldVersion ||
    !Number.isFinite(Date.parse(player.occurredAt)) ||
    Date.parse(player.occurredAt) > Date.parse(position.occurredAt) ||
    !scene.presence.some(
      (p) =>
        p.participant.kind === 'player' &&
        p.joinedVersion < position.worldVersion &&
        (p.leftVersion === undefined || p.leftVersion > position.worldVersion),
    ) ||
    scene.presence.some(
      (p) =>
        p.participant.kind === 'actor' &&
        p.participant.actorId === actorId &&
        p.joinedVersion <= position.worldVersion &&
        (p.leftVersion === undefined || p.leftVersion > position.worldVersion),
    )
  )
    return scene;
  return {
    ...structuredClone(scene),
    presence: [
      ...structuredClone(scene.presence),
      {
        participant: { kind: 'actor', actorId },
        joinedVersion: position.worldVersion,
        sourceVersion: position.worldVersion,
        sourceEventId: position.sourceEventId!,
      },
    ],
  };
}

/** A scene opens with people who are already at that place. The scene-entry
 * event witnesses current presence; it is not a journey, an arrival or a claim
 * that the actor entered at this instant. */
export function seedScenePresenceAtOpen(
  scene: SceneSession,
  positions: readonly AuthoritativePosition[],
  source: { sourceEventId: string; sourceVersion: number },
): SceneSession {
  if (
    scene.status !== 'active' ||
    !scene.placeId ||
    !source.sourceEventId ||
    !Number.isSafeInteger(source.sourceVersion) ||
    source.sourceVersion < 0 ||
    !Array.isArray(positions)
  )
    return scene;
  const alreadyPresent = new Set(
    scene.presence.flatMap((entry) =>
      entry.participant.kind === 'actor' && entry.leftVersion === undefined
        ? [entry.participant.actorId]
        : [],
    ),
  );
  const additions = positions
    .filter((position) => {
      if (
        position.worldId !== scene.worldId ||
        position.subject.kind !== 'actor' ||
        !position.subject.actorId ||
        position.status !== 'at' ||
        position.placeId !== scene.placeId ||
        !Number.isSafeInteger(position.worldVersion) ||
        position.worldVersion < 0 ||
        position.worldVersion > source.sourceVersion ||
        !Number.isFinite(Date.parse(position.occurredAt)) ||
        alreadyPresent.has(position.subject.actorId)
      )
        return false;
      alreadyPresent.add(position.subject.actorId);
      return true;
    })
    .sort((left, right) =>
      left.subject.kind === 'actor' && right.subject.kind === 'actor'
        ? left.subject.actorId.localeCompare(right.subject.actorId)
        : 0,
    )
    .map((position) => ({
      participant: {
        kind: 'actor' as const,
        actorId: (position.subject as { kind: 'actor'; actorId: string }).actorId,
      },
      joinedVersion: source.sourceVersion,
      sourceEventId: source.sourceEventId,
      sourceVersion: source.sourceVersion,
    }));
  if (!additions.length) return scene;
  return {
    ...structuredClone(scene),
    presence: [...structuredClone(scene.presence), ...additions],
  };
}
