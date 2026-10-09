import type { SceneHistory, SceneRead, SceneSummary } from '../../../contracts/scenes.ts';
import type { PhoneInvitation } from '../apps/types.ts';
import { scenePresent } from '../../../modules/world/domain/scene-runtime.ts';
/** A prior record is a view target, never evidence of a new visit. */
export function appointmentScene(
  history: SceneHistory,
  appointment: Pick<PhoneInvitation, 'id' | 'responseVersion'>,
) {
  return history.appointmentScenes.find(
    (s) =>
      s.appointmentId === appointment.id &&
      (appointment.responseVersion === undefined || appointment.responseVersion <= s.sourceVersion),
  );
}
export function canEnterAppointment(history: SceneHistory, invitation: PhoneInvitation) {
  return (
    invitation.status === 'confirmed' &&
    !history.paused &&
    !history.currentScene &&
    Date.parse(invitation.at) <= Date.parse(history.storyNow) &&
    !appointmentScene(history, invitation)
  );
}
export function mergeHistory(current: readonly SceneSummary[], next: readonly SceneSummary[]) {
  const records = new Map(current.map((s) => [s.id, s]));
  for (const scene of next)
    if (!records.has(scene.id) || records.get(scene.id)!.sourceVersion <= scene.sourceVersion)
      records.set(scene.id, scene);
  return [...records.values()].sort((a, b) => b.sourceVersion - a.sourceVersion);
}
export function sceneOverview(read: SceneRead) {
  const place = read.entries.filter((e) => e.kind === 'time_place').at(-1);
  const environment = read.entries
    .filter((e) => e.kind === 'narration' && e.observableTo.some((p) => p.kind === 'player'))
    .at(-1);
  const people = read.scene
    ? scenePresent(read.scene, read.worldVersion).filter((p) => p.kind === 'actor')
    : [];
  return { place, environment, people };
}
