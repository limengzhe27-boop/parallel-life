import {
  authenticated,
  endpoint,
  HttpError,
  json,
  parseBody,
} from '../../../../../../server/http.ts';
import {
  InvitationRequestSchema,
  InvitationReceiptSchema,
} from '../../../../../../contracts/invitations.ts';
import { Id } from '../../../../../../contracts/api.ts';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('INVALID_INPUT', 422);
    const input = await parseBody(request, InvitationRequestSchema);
    try {
      const state = await s.worlds.respondToInvitation(
        { userId: s.ownerId },
        { ...input, worldId: worldId.data },
      );
      return json(
        InvitationReceiptSchema.parse({
          status: 'committed',
          commandId: input.commandId,
          worldId: state.id,
          version: state.version,
          invitation: (({ sourceEventId: _source, ...a }) => a)(
            state.appointments.find((a) => a.id === input.id)!,
          ),
        }),
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'INVALID_COMMAND')
        throw new HttpError('INVALID_INPUT', 422);
      throw error;
    }
  });
}
