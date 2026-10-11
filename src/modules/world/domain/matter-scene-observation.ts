import type { WorldMatter } from './matters.ts';
import type { SceneAction } from './experience-rules.ts';

/** A matching stored action resolution is the only source of this player-facing observation. */
export function matterSceneObservation(
  matter: WorldMatter,
  action: SceneAction,
  source: {
    ownerId: string;
    worldId: string;
    worldVersion: number;
    eventId: string;
    eventVersion: number;
  },
): string | undefined {
  const evidence = matter.evidence;
  const resolution = action.resolution;
  if (
    matter.worldId !== source.worldId ||
    matter.visibility !== 'player_visible' ||
    evidence?.kind !== 'scene_action' ||
    action.worldId !== source.worldId ||
    action.ownerId !== source.ownerId ||
    action.sceneId !== evidence.sceneId ||
    action.id !== evidence.actionId ||
    action.intent !== 'attempt' ||
    action.status !== 'resolved' ||
    !action.relatedMatterIds.includes(matter.id) ||
    !resolution ||
    resolution.sourceEventId !== evidence.eventId ||
    resolution.sourceVersion !== evidence.eventVersion ||
    resolution.outcome !== evidence.outcome ||
    evidence.eventId !== source.eventId ||
    evidence.eventVersion !== source.eventVersion ||
    evidence.eventVersion > source.worldVersion ||
    (matter.status === 'completed' && resolution.outcome !== 'succeeded')
  )
    return;
  const observation = resolution.observation.trim();
  return observation && observation.length <= 4000 ? observation : undefined;
}
