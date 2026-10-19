import { WorldMessageRequestSchema } from '../../../../../../../contracts/world-interaction.ts';
import { MessageReceiptLookupSchema } from '../../../../../../../contracts/message-receipt-lookup.ts';
import { Id } from '../../../../../../../contracts/api.ts';
import { NpcMessageError } from '../../../../../../../server/npc-agent-services.ts';
import {
  authenticated,
  endpoint,
  HttpError,
  json,
  parseBody,
} from '../../../../../../../server/http.ts';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Explicitly apply only this command's protected response; never send another model request. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, WorldMessageRequestSchema);
    try {
      const recovered = await s.npcAgents.recoverMessage(s.ownerId, {
        id: input.commandId,
        worldId: worldId.data,
        actorId: input.actorId,
        text: input.text,
        expectedVersion: input.expectedVersion,
      });
      return json(MessageReceiptLookupSchema.parse(recovered));
    } catch (error) {
      if (error instanceof NpcMessageError) throw new HttpError(error.apiCode, error.status);
      throw error;
    }
  });
}
