import type { Appointment, WorldState } from './types.ts';
import type { SceneSession } from './experience-rules.ts';
import { scenePresent } from './scene-runtime.ts';

export type SceneAttendanceEvent = {
  id: string;
  worldId: string;
  version: number;
  storyAt: string;
  type: 'scene.opened' | 'scene.action_resolved';
  data: {
    sceneId: string;
    worldResults?: { scene: SceneSession; attendance?: { appointmentId: string } };
  };
};

/** Verify the stored attendance event, not the model's dialogue or a later player's location. */
export function sceneAttendanceSource(
  world: WorldState,
  appointment: Appointment,
  event: SceneAttendanceEvent,
) {
  const scene = event.data.worldResults?.scene;
  if (
    !scene ||
    event.worldId !== world.id ||
    event.version > world.version ||
    appointment.status !== 'attended' ||
    appointment.responseVersion !== event.version ||
    appointment.responseAt !== event.storyAt ||
    !Number.isFinite(Date.parse(event.storyAt)) ||
    Date.parse(event.storyAt) < Date.parse(appointment.at) ||
    event.data.worldResults?.attendance?.appointmentId !== appointment.id ||
    scene.id !== event.data.sceneId ||
    scene.ownerId !== world.ownerId ||
    scene.worldId !== world.id ||
    !scene.placeId ||
    !Array.isArray(scene.presence)
  )
    return;
  const place = world.space?.places.find((p) => p.id === scene.placeId);
  if (
    !place ||
    !place.appointmentIds.includes(appointment.id) ||
    (scene.appointmentId && scene.appointmentId !== appointment.id)
  )
    return;
  const present = scenePresent(scene, event.version);
  if (
    !present.some((p) => p.kind === 'player') ||
    !present.some((p) => p.kind === 'actor' && appointment.participantIds.includes(p.actorId))
  )
    return;
  return {
    kind: 'world_event' as const,
    eventId: event.id,
    eventVersion: event.version,
    at: event.storyAt,
    timeBasis: 'story' as const,
  };
}
