import type { WorldPhone } from '../../contracts/world-build.ts';
import type { PhoneAppsData } from './apps/types.ts';
/** Map the authorized opening projection only; no private interview or inferred events. */
export function worldAppData(
  world: WorldPhone,
  viewed: ReadonlySet<string> = new Set(),
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
    messages: (() => {
      const assistantMsgs = world.messages.filter((m) => m.role !== 'user');
      const allSameTime =
        assistantMsgs.length > 1 && assistantMsgs.every((m) => m.at === assistantMsgs[0]?.at);
      const offsets = [3, 28, 110, 340];
      return world.messages.map((message, index) => {
        let displayAt = message.at;
        if (allSameTime && message.role !== 'user') {
          const offsetMinutes = offsets[index] ?? 340 + index * 60;
          displayAt = new Date(Date.parse(message.at) - offsetMinutes * 60 * 1000).toISOString();
        }
        return {
          id: message.id,
          actorId: message.actorId,
          text: message.text,
          at: displayAt,
          role: message.role ?? 'assistant',
          status: 'sent',
        };
      });
    })(),
    notes: world.notes.map((note, index) => ({
      ...note,
      id: `${world.id}:opening-note:${index}`,
      version: 0,
      updatedAt: world.time,
    })),
    photos: (world.photos ?? []).map((photo) => ({
      id: photo.id,
      date: photo.date,
      title: photo.title,
      description: photo.kind === 'upload' ? '你上传的照片' : 'AI生成的照片',
      status: 'ready',
      url: `/api/v1/assets/${encodeURIComponent(photo.id)}?revision=${photo.revision}`,
    })),
    invitations: (world.invitations ?? []).map((invitation) => ({
      ...invitation,
      version: world.version ?? 0,
    })),
  };
}
