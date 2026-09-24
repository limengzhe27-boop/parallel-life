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
      name: actor.name,
      relationship: actor.relationship,
      summary: actor.summary,
      unread: world.messages.filter(
        (message) =>
          message.actorId === actor.id && message.role !== 'user' && !viewed.has(message.id),
      ).length,
    })),
    photos: (world.photos ?? []).map((photo) => {
      let description = photo.kind === 'upload' ? '你上传的照片' : 'AI生成的照片';
      let tag: 'identity' | 'event' | 'upload' = 'upload';
      if (
        photo.title.includes('【身份写真】') ||
        photo.title.includes('写真') ||
        photo.title.includes('角色肖像') ||
        photo.title.includes('肖像')
      ) {
        tag = 'identity';
        description =
          '✨ 平行人生身份写真：根据您的肖像底模与分支角色身份图生图渲染而成，已存入您的平行人生相册。';
      } else if (
        photo.title.includes('【事件纪念】') ||
        photo.title.includes('纪念') ||
        photo.title.includes('现场') ||
        photo.kind === 'generated'
      ) {
        tag = 'event';
        description =
          '📸 剧情事件解锁：在与平行世界角色的剧情推演与重要时刻中解锁，记录属于你们的生动瞬间。';
      }
      return {
        id: photo.id,
        date: photo.date,
        title: photo.title,
        description,
        status: 'ready' as const,
        tag,
        url: `/api/v1/assets/${encodeURIComponent(photo.id)}?revision=${photo.revision}`,
      };
    }),
    messages: [
      ...world.messages.map((message) => {
        // Link photo if message refers to a photo title or shared photo
        const matchedPhoto = (world.photos ?? []).find(
          (p) =>
            message.text.includes(`《${p.title}》`) ||
            (message.text.includes(p.title) && p.title.length > 4),
        );
        return {
          id: message.id,
          actorId: message.actorId,
          text: message.text,
          /* The server already staggers opening timestamps; display them as stored. */
          at: message.at,
          role: message.role ?? 'assistant',
          status: 'sent' as const,
          photo: matchedPhoto
            ? {
                id: matchedPhoto.id,
                date: matchedPhoto.date,
                title: matchedPhoto.title,
                description:
                  matchedPhoto.kind === 'upload' ? '相册照片' : '剧情事件解锁剧照',
                status: 'ready' as const,
                url: `/api/v1/assets/${encodeURIComponent(matchedPhoto.id)}?revision=${matchedPhoto.revision}`,
              }
            : undefined,
        };
      }),
      ...local.map((message) => ({ ...message })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    notes: world.notes.map((note) => ({ ...note })),
    invitations: (world.invitations ?? []).map((invitation) => ({
      ...invitation,
      version: world.version ?? 0,
    })),
  };
}
