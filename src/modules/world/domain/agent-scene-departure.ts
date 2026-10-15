import type { SceneSession } from './experience-rules.ts';
import { DomainError } from './errors.ts';

/** Canonical closure of an existing presence interval; never a new scene or invented arrival. */
export type AgentSceneDeparture = {
  sceneId: string;
  actorId: string;
  joinedVersion: number;
  joinedSourceEventId: string;
};

export function applyAgentSceneDeparture(
  scene: SceneSession,
  input: {
    worldId: string;
    actorId: string;
    eventId: string;
    worldVersion: number;
    fromPlaceId: string;
    departure: AgentSceneDeparture;
  },
): SceneSession {
  const d = input.departure;
  if (
    scene.worldId !== input.worldId ||
    scene.id !== d.sceneId ||
    scene.status !== 'active' ||
    scene.placeId !== input.fromPlaceId ||
    d.actorId !== input.actorId ||
    !Number.isSafeInteger(input.worldVersion) ||
    input.worldVersion <= d.joinedVersion ||
    !input.eventId
  )
    throw new DomainError('INVALID_PROPOSAL', 'INVALID_AGENT_SCENE_DEPARTURE');
  const matching = scene.presence.filter(
    (p) =>
      p.participant.kind === 'actor' &&
      p.participant.actorId === input.actorId &&
      p.joinedVersion === d.joinedVersion &&
      p.sourceEventId === d.joinedSourceEventId,
  );
  if (
    matching.length !== 1 ||
    (matching[0]!.leftVersion !== undefined && matching[0]!.leftVersion !== input.worldVersion)
  )
    throw new DomainError('INVALID_PROPOSAL', 'INVALID_AGENT_SCENE_DEPARTURE');
  return {
    ...structuredClone(scene),
    presence: scene.presence.map((p) =>
      p === matching[0]
        ? { ...structuredClone(p), leftVersion: input.worldVersion }
        : structuredClone(p),
    ),
  };
}
