import { InvitationSchema } from '../contracts/invitations.ts';
import type { WorldState } from '../modules/world/domain/types.ts';
import { verifiedGenesisLinks } from '../modules/world/domain/genesis-links.ts';

/** Serialize the committed receipt version, never spread internal runtime fields. */
export function publicInvitation(state: WorldState, invitationId: string) {
  const item = state.appointments.find((a) => a.id === invitationId);
  if (!item) throw Error('INVITATION_NOT_FOUND');
  const origin = verifiedGenesisLinks(state).find((e) => e.invitationId === item.id)?.source;
  return InvitationSchema.parse({
    id: item.id,
    title: item.title,
    at: item.at,
    participantIds: item.participantIds,
    status: item.status,
    ...(item.responseAt !== undefined ? { responseAt: item.responseAt } : {}),
    ...(item.responseVersion !== undefined ? { responseVersion: item.responseVersion } : {}),
    ...(origin ? { origin } : {}),
  });
}
