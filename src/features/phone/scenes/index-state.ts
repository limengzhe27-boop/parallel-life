import type { PhoneMapContext } from '../map/context.ts';
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
export function canEnterAppointment(
  history: SceneHistory,
  invitation: PhoneInvitation,
  storyNow = history.storyNow,
) {
  return (
    invitation.status === 'confirmed' &&
    !history.paused &&
    !history.currentScene &&
    Date.parse(invitation.at) <= Date.parse(storyNow) &&
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

/** An app entry reads current projections; only the explicit enter button invokes an existing command. */
export function sceneHomeEntry(
  history: SceneHistory | undefined,
  map: Pick<PhoneMapContext, 'data' | 'working' | 'operation'> | undefined,
) {
  const space = map?.data;
  const latestIsSpace = !!space && (!history || space.worldVersion > history.worldVersion);
  const currentSceneId = latestIsSpace
    ? space.currentSceneId
    : (history?.currentScene?.id ??
      (space?.worldVersion === history?.worldVersion ? space?.currentSceneId : null) ??
      null);
  const currentPlace = space?.places.find((place) => place.id === space.currentPlaceId);
  const unresolvedTravel = map?.operation && ['pending', 'unknown'].includes(map.operation.status);
  const blockedReason = !space
    ? '正在读取当前位置。'
    : !currentPlace
      ? '当前位置尚未确认，可以在地图中查看地点。'
      : space.paused
        ? '时间已暂停，可以回看记录，继续后再进入现场。'
        : map?.working || space.busy || unresolvedTravel
          ? '请先等待当前操作完成，或到地图核对行程。'
          : null;
  return {
    currentSceneId,
    currentPlace,
    canEnterCurrentPlace: !currentSceneId && !!currentPlace && !blockedReason,
    blockedReason,
  };
}
