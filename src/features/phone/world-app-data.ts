import type { WorldPhone } from '../../contracts/world-build.ts';
import type { PhoneAppsData, PhoneMessage } from './apps/types.ts';
/**
 * Map the authorized opening projection only; no private interview or inferred events.
 *
 * `local` carries messages this browser sent that the server has not confirmed.
 * Server messages are honestly `sent`; a local entry keeps its own pending/failed
 * state, so a failed send never looks delivered.
 */
export function worldAppData(
  world: WorldPhone,
  viewed: ReadonlySet<string> = new Set(),
  local: readonly PhoneMessage[] = [],
): PhoneAppsData {
  return {
    contacts: world.actors.map((actor) => ({
      id: actor.id,
      ...(actor.sourcePersonId ? { sourcePersonId: actor.sourcePersonId } : {}),
      name: actor.name,
      relationship: actor.relationship,
      summary: actor.summary,
      ...(actor.photo
        ? {
            avatarUrl:
              '/api/v1/assets/' +
              actor.photo.assetId +
              '?worldId=' +
              world.id +
              '&revision=' +
              actor.photo.revision,
          }
        : {}),
      unread: world.messages.filter(
        (message) =>
          message.actorId === actor.id &&
          message.role !== 'user' &&
          message.initialRead !== true &&
          !viewed.has(message.id),
      ).length,
    })),
    photos: (world.photos ?? []).map((photo) => {
      const uploaded = photo.kind === 'upload';
      const identity = !uploaded && /写真|肖像/.test(photo.title);
      const tag = uploaded
        ? ('upload' as const)
        : identity
          ? ('identity' as const)
          : ('event' as const);
      const description = photo.sourcePersonId
        ? '用户带入的原图 · 日期为上传时间，不代表拍摄或共同经历'
        : uploaded
          ? '你上传的照片'
          : identity
            ? '历史素材 · 生成来源待核验'
            : '历史素材 · 生成来源待核验';
      return {
        id: photo.id,
        date: photo.date,
        title: photo.title,
        description,
        status: 'ready' as const,
        tag,
        url: `/api/v1/assets/${encodeURIComponent(photo.id)}?worldId=${encodeURIComponent(world.id)}&revision=${photo.revision}`,
        ...(photo.sourcePersonId ? { sourcePersonId: photo.sourcePersonId } : {}),
      };
    }),
    messages: [
      ...world.messages.map((message) => {
        return {
          id: message.id,
          actorId: message.actorId,
          text: message.text,
          /* The server already staggers opening timestamps; display them as stored. */
          at: message.at,
          role: message.role ?? 'assistant',
          status: 'sent' as const,
          ...(message.initialRead !== undefined ? { initialRead: message.initialRead } : {}),
        };
      }),
      ...local.map((message) => ({ ...message })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    notes: world.notes.map((note) => ({ ...note })),
    choices: (world.choices ?? []).map((choice) => ({
      id: choice.id,
      actorName: world.actors.find((actor) => actor.id === choice.actorId)?.name ?? '这段对话',
      quote: choice.quote,
      intent: choice.intent,
      at: choice.at,
      status: choice.status,
      ...(choice.nextStep
        ? {
            nextStep: {
              quote: choice.nextStep.quote,
              at: choice.nextStep.at,
              ...(choice.nextStep.calendar ? { calendar: choice.nextStep.calendar } : {}),
            },
          }
        : {}),
      ...(choice.result
        ? {
            result: {
              kind: choice.result.kind,
              quote: choice.result.quote,
              at: choice.result.at,
            },
          }
        : {}),
      ...(choice.recoveryStep
        ? {
            recoveryStep: {
              quote: choice.recoveryStep.quote,
              at: choice.recoveryStep.at,
            },
          }
        : {}),
    })),
    invitations: (world.invitations ?? []).map((invitation) => ({
      ...invitation,
      version: world.version ?? 0,
    })),
  };
}
