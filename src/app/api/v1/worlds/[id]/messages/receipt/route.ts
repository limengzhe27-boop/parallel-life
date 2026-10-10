import { checkMessageReceipt } from '../../../../../../../modules/world/application/check-message-receipt.ts';
import { WorldMessageRequestSchema } from '../../../../../../../contracts/world-interaction.ts';
import { MessageReceiptLookupSchema } from '../../../../../../../contracts/message-receipt-lookup.ts';
import { Id } from '../../../../../../../contracts/api.ts';
import {
  authenticated,
  endpoint,
  HttpError,
  json,
  parseBody,
} from '../../../../../../../server/http.ts';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, WorldMessageRequestSchema);
    const saved = await checkMessageReceipt(
      { worlds: s.worlds },
      { userId: s.ownerId },
      {
        id: input.commandId,
        worldId: worldId.data,
        actorId: input.actorId,
        text: input.text,
        expectedVersion: input.expectedVersion,
      },
    );
    const identity = { commandId: input.commandId, worldId: worldId.data, actorId: input.actorId };
    return json(
      MessageReceiptLookupSchema.parse(
        saved
          ? {
              ...identity,
              status: 'committed',
              version: saved.state.version,
              eventId: saved.event.id,
            }
          : { ...identity, status: 'unconfirmed' },
      ),
    );
  });
}
