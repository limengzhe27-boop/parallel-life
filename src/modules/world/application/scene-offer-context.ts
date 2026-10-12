import type { ScenePlanningContext } from './scene-ports.ts';
/** Stage direction for this actually sourced invitation only; it never establishes knowledge or action. */
export function sceneOfferIntent(context: ScenePlanningContext, actorId?: string) {
  const b = context.currentOfferBrief;
  const a = context.world.appointments.find((a) => a.id === context.scene.appointmentId);
  if (
    !b ||
    !a ||
    !['confirmed', 'attended'].includes(a.status ?? '') ||
    b.invitationId !== a.id ||
    b.sourceEventId !== a.sourceEventId ||
    b.placeId !== context.scene.placeId ||
    b.placeId !== context.world.space?.currentPlaceId
  )
    return null;
  if (actorId && (!b.actorIds.includes(actorId) || !a.participantIds.includes(actorId)))
    return null;
  return {
    editorialIntent: b.editorialIntent,
    instruction:
      '这是当前邀约的可选舞台意图，不是已发生事实或你的新增知识。保持本人知情边界；不替主角决定、执行动作或预设结局，不向主角复述导演说明。',
  };
}
