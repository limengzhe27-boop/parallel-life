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
    messages: [
      ...world.messages.map((message) => ({
        id: message.id,
        actorId: message.actorId,
        text: message.text,
        /* The server already staggers opening timestamps; display them as stored. */
        at: message.at,
        role: message.role ?? 'assistant',
        status: 'sent' as const,
      })),
      ...local.map((message) => ({ ...message })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
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
