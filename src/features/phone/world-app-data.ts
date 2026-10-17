import { resolveAvatarArt } from './avatar-art.ts';
import type { WorldPhone } from '../../contracts/world-build.ts';
import type { PhoneAppsData, PhoneMessage, PhonePhoto } from './apps/types.ts';
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
  mediaUrlFor: (worldId: string, assetId: string) => string = (worldId, assetId) =>
    `/api/v1/worlds/${encodeURIComponent(worldId)}/media/${encodeURIComponent(assetId)}`,
): PhoneAppsData {
  const history = world.historyLinks ?? [];
  const historyLinks = (entry: (typeof history)[number]) => [
    {
      app: 'notes' as const,
      target: entry.recordId,
      label: '\u67e5\u770b\u65e7\u6765\u4fe1\u8bb0\u5f55',
    },
    ...(entry.invitationId
      ? [
          {
            app: 'calendar' as const,
            target: entry.invitationId,
            label: '\u67e5\u770b\u65e5\u7a0b',
          },
        ]
      : []),
  ];
  const photos = (world.photos ?? []).map((photo) => {
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
      links: history
        .filter((e) => e.photoIds.includes(photo.id))
        .map((e) => ({
          app: 'notes' as const,
          target: e.recordId,
          label: '\u76f8\u5173\u65e7\u6765\u4fe1\u8bb0\u5f55',
        })),
      id: photo.id,
      date: photo.date,
      title: photo.title,
      description,
      status: 'ready' as const,
      tag,
      url: `/api/v1/assets/${encodeURIComponent(photo.id)}?worldId=${encodeURIComponent(world.id)}&revision=${photo.revision}`,
      ...(photo.sourcePersonId ? { sourcePersonId: photo.sourcePersonId } : {}),
      ...(photo.mimeType ? { mimeType: photo.mimeType } : {}),
    };
  });
  return {
    contacts: world.actors.map((actor) => {
      const art = resolveAvatarArt(world, actor);
      return {
        id: actor.id,
        ...(actor.sourcePersonId ? { sourcePersonId: actor.sourcePersonId } : {}),
        name: actor.name,
        relationship: actor.relationship,
        summary: actor.summary,
        ...(actor.publicProfile ? { publicProfile: actor.publicProfile } : {}),
        avatarUrl: art.url,
        avatarKind: art.kind,
        avatarLabel: art.label,
        unread: world.messages.filter(
          (message) =>
            message.actorId === actor.id &&
            message.role !== 'user' &&
            message.initialRead !== true &&
            !viewed.has(message.id),
        ).length,
      };
    }),
    photos,
    messages: [
      ...world.messages.map((message) => {
        let photo: PhonePhoto | undefined = undefined;
        const isVideo = message.mediaType === 'video';
        if (message.photoId) {
          const matchedPhoto = photos.find((p) => p.id === message.photoId);
          if (matchedPhoto) {
            photo = {
              ...matchedPhoto,
              mediaType: message.mediaType ?? (matchedPhoto.mimeType === 'video/mp4' ? 'video' : 'image'),
            };
          } else {
            photo = {
              id: message.photoId,
              date: message.at,
              title: message.mediaTitle || (isVideo ? '剧情视频' : '剧情照片'),
              description: isVideo ? '剧情关键片段视频' : '剧情事件照片',
              status: 'ready' as const,
              tag: 'event' as const,
              mediaType: isVideo ? 'video' : 'image',
              url: `/api/v1/assets/${encodeURIComponent(message.photoId)}?worldId=${encodeURIComponent(world.id)}&revision=1`,
            };
          }
        } else if (message.mediaStatus === 'pending') {
          photo = {
            id: `pending_${message.id}`,
            date: message.at,
            title: message.mediaTitle || (isVideo ? '正在渲染视频片段...' : '正在记录画面...'),
            description: isVideo ? 'AI 视频片段生成中，完成后将在此展示' : 'AI 摄影记录中，生成后将在此展示并同步至相册',
            status: 'generating' as const,
            tag: 'event' as const,
            mediaType: isVideo ? 'video' : 'image',
          };
        } else if (message.mediaStatus === 'failed') {
          photo = {
            id: `failed_${message.id}`,
            date: message.at,
            title: message.mediaTitle || (isVideo ? '视频生成未完成' : '画面记录未完成'),
            description: '生成未成功或已取消',
            status: 'failed' as const,
            tag: 'event' as const,
            mediaType: isVideo ? 'video' : 'image',
          };
        } else if (message.text) {
          const match = message.text.match(/^\[分享了相册照片：《(.+?)》\]$/);
          if (match) {
            const matchedPhoto = photos.find((p) => p.title === match[1]);
            if (matchedPhoto) {
              photo = matchedPhoto;
            }
          }
        }
        const media = (
          message as typeof message & {
            attachment?: {
              kind: 'image' | 'video';
              assetId: string;
              label?: string;
            };
          }
        ).attachment;
        return {
          ...(history.find((e) => e.messageId === message.id)
            ? { links: historyLinks(history.find((e) => e.messageId === message.id)!) }
            : {}),
          id: message.id,
          actorId: message.actorId,
          text: message.text,
          /* The server already staggers opening timestamps; display them as stored. */
          at: message.at,
          role: message.role ?? 'assistant',
          status: 'sent' as const,
          ...(message.initialRead !== undefined ? { initialRead: message.initialRead } : {}),
          ...(message.mediaType ? { mediaType: message.mediaType } : {}),
          ...(photo ? { photo } : {}),
          ...(media && (media.kind === 'image' || media.kind === 'video') && media.assetId
            ? {
                attachment: {
                  kind: media.kind,
                  assetId: media.assetId,
                  ...(media.label ? { label: media.label } : {}),
                  url: mediaUrlFor(world.id, media.assetId),
                },
              }
            : {}),
        };
      }),
      ...local.map((message) => ({ ...message })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    notes: (world.notes ?? []).map((note) => ({ ...note })),
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
      ...(history.find((e) => e.invitationId === invitation.id)
        ? {
            links: [
              {
                app: 'messages' as const,
                target: history.find((e) => e.invitationId === invitation.id)!.actorId,
                label: '\u67e5\u770b\u6765\u6e90\u5bf9\u8bdd',
              },
              {
                app: 'notes' as const,
                target: history.find((e) => e.invitationId === invitation.id)!.recordId,
                label: '\u67e5\u770b\u65e7\u6765\u4fe1\u8bb0\u5f55',
              },
            ],
          }
        : {}),
      version: world.version ?? 0,
    })),
  };
}
