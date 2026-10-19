import { checkMessageReceipt } from '../../../../../../../modules/world/application/check-message-receipt.ts';
import {
  WORLD_MESSAGE_PROJECTION_HEADER,
  WORLD_MESSAGE_PROJECTION_VERSION,
  WorldMessageReceiptSchema,
  WorldMessageRequestSchema,
  worldMessageClientReceipt,
} from '../../../../../../../contracts/world-interaction.ts';
import { MessageReceiptLookupSchema } from '../../../../../../../contracts/message-receipt-lookup.ts';
import { toContractStreamSummary } from '../../../../../../../modules/world/domain/npc-stream-segment.ts';
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
    const projectionVersion = request.headers.get(WORLD_MESSAGE_PROJECTION_HEADER);
    const wantsRecovery = request.headers.get('x-message-recovery') === '1';

    const current = await s.npcAgents.lookupMessage(s.ownerId, {
      id: input.commandId,
      worldId: worldId.data,
      actorId: input.actorId,
      text: input.text,
      expectedVersion: input.expectedVersion,
    });
    if (current) {
      if (current.status === 'committed') {
        let completeReceipt = current;
        if (projectionVersion === WORLD_MESSAGE_PROJECTION_VERSION) {
          const messages = await s.npcAgents.readCommittedTurnMessages?.(s.ownerId, current);
          const metrics = s.npcAgents.readTurnMetrics?.(input.commandId);
          const streamData = await s.npcAgents.readStreamSegments?.(
            s.ownerId,
            worldId.data,
            input.commandId,
          );
          completeReceipt = {
            ...current,
            ...(messages ? { messages } : {}),
            ...(metrics ? { metrics } : {}),
            ...(streamData?.summary
              ? { streamSummary: toContractStreamSummary(streamData.summary) }
              : {}),
          };
        }
        return json(
          MessageReceiptLookupSchema.parse(
            worldMessageClientReceipt(
              WorldMessageReceiptSchema.parse(completeReceipt),
              projectionVersion,
            ),
          ),
        );
      }

      if (current.status === 'unconfirmed') {
        let unconfirmedObj = { ...current };
        if (projectionVersion === WORLD_MESSAGE_PROJECTION_VERSION) {
          const streamData = await s.npcAgents.readStreamSegments?.(
            s.ownerId,
            worldId.data,
            input.commandId,
          );
          if (streamData?.summary)
            unconfirmedObj.streamSummary = toContractStreamSummary(streamData.summary);
          if (streamData?.messages?.length) unconfirmedObj.messages = streamData.messages;
        }
        if (!wantsRecovery) {
          const { recovery: _recovery, ...clean } = unconfirmedObj;
          return json(MessageReceiptLookupSchema.parse(clean));
        }
        return json(MessageReceiptLookupSchema.parse(unconfirmedObj));
      }

      return json(MessageReceiptLookupSchema.parse(current));
    }

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
    if (!saved) {
      return json(MessageReceiptLookupSchema.parse({ ...identity, status: 'unconfirmed' }));
    }
    const baseCommitted = {
      ...identity,
      status: 'committed' as const,
      version: saved.state.version,
      eventId: saved.event.id,
    };
    if (projectionVersion === WORLD_MESSAGE_PROJECTION_VERSION) {
      const messages = saved.state.messages
        .filter(
          (m) =>
            m.sourceEventId === saved.event.id &&
            m.actorId === input.actorId &&
            (m.role === 'user' || m.role === 'assistant'),
        )
        .map((m) => ({
          id: m.id,
          actorId: m.actorId,
          role: m.role as 'user' | 'assistant',
          text: m.text,
          at: m.at,
          sourceEventId: saved.event.id,
          sourceVersion: saved.state.version,
        }));
      return json(
        MessageReceiptLookupSchema.parse(
          worldMessageClientReceipt(
            WorldMessageReceiptSchema.parse({ ...baseCommitted, messages }),
            projectionVersion,
          ),
        ),
      );
    }
    return json(
      MessageReceiptLookupSchema.parse(
        worldMessageClientReceipt(
          WorldMessageReceiptSchema.parse(baseCommitted),
          projectionVersion,
        ),
      ),
    );
  });
}
