import { after } from 'next/server';
import { runCommittedChatMedia } from './chat-media-tasks.ts';
import { resolveTurn } from '../modules/world/application/resolve-turn.ts';
import { NpcMessageError } from './npc-agent-services.ts';
import {
  WORLD_MESSAGE_PROJECTION_HEADER,
  WORLD_MESSAGE_PROJECTION_VERSION,
  WORLD_MESSAGE_STREAM_HEADER,
  WORLD_MESSAGE_STREAM_VERSION,
  WorldMessageRequestSchema,
  WorldMessageReceiptSchema,
  worldMessageClientReceipt,
} from '../contracts/world-interaction.ts';
import { toContractStreamSummary } from '../modules/world/domain/npc-stream-segment.ts';
import { Id } from '../contracts/api.ts';
import { projectStoryTime } from '../modules/world/domain/clock.ts';
import {
  authenticated,
  endpoint,
  HttpError,
  httpFailureResponse,
  json,
  parseBody,
} from './http.ts';

/** Start durable media while the receipt is projected/sent; after retains the same
 * promise for the platform lifetime, rather than starting a second job later. */
function startCommittedMedia(...args: Parameters<typeof runCommittedChatMedia>) {
  let completion: Promise<void> = Promise.resolve();
  after(() => completion);
  completion = runCommittedChatMedia(...args).catch(() => {
    console.warn(JSON.stringify({ scope: 'chat-media-task', code: 'EXECUTION_UNAVAILABLE' }));
  });
}

export async function worldMessageRoute(request: Request, worldId: string) {
  return endpoint(async (context) => {
    const s = await authenticated(request);
    const parsedWorldId = Id.safeParse(worldId);
    if (!parsedWorldId.success) throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, WorldMessageRequestSchema);
    const projectionVersion = request.headers.get(WORLD_MESSAGE_PROJECTION_HEADER);
    const streamHeader = request.headers.get(WORLD_MESSAGE_STREAM_HEADER);
    const isStream = streamHeader === WORLD_MESSAGE_STREAM_VERSION;

    if (isStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const receipt = await s.npcAgents.sendMessageIfEnabled(
              s.ownerId,
              {
                id: input.commandId,
                worldId: parsedWorldId.data,
                expectedVersion: input.expectedVersion,
                actorId: input.actorId,
                text: input.text,
              },
              {
                onSegment: (segment) => {
                  controller.enqueue(
                    encoder.encode(JSON.stringify({ type: 'segment', segment }) + '\n'),
                  );
                },
              },
            );
            if (receipt) {
              try {
                startCommittedMedia(s.db, s.ownerId, parsedWorldId.data, receipt.eventId);
              } catch (error) {
                console.warn(
                  JSON.stringify({
                    scope: 'outbox-drain',
                    code: (error as { code?: string })?.code ?? 'FAILED',
                  }),
                );
              }
              let completeReceipt = receipt;
              if (projectionVersion === WORLD_MESSAGE_PROJECTION_VERSION) {
                const messages = await s.npcAgents.readCommittedTurnMessages?.(s.ownerId, receipt);
                const metrics = s.npcAgents.readTurnMetrics?.(input.commandId);
                const streamData = await s.npcAgents.readStreamSegments?.(
                  s.ownerId,
                  parsedWorldId.data,
                  input.commandId,
                );
                completeReceipt = {
                  ...receipt,
                  ...(messages ? { messages } : {}),
                  ...(metrics ? { metrics } : {}),
                  ...(streamData?.summary
                    ? { streamSummary: toContractStreamSummary(streamData.summary) }
                    : {}),
                };
              }
              const clientReceipt = worldMessageClientReceipt(
                WorldMessageReceiptSchema.parse(completeReceipt),
                projectionVersion,
              );
              controller.enqueue(
                encoder.encode(JSON.stringify({ type: 'complete', receipt: clientReceipt }) + '\n'),
              );
              controller.close();
              return;
            }

            const legacyReceipt = await s.withWorldActivityLock(parsedWorldId.data, async () => {
              const clock = await s.readWorldClock(s.ownerId, parsedWorldId.data);
              const result = await resolveTurn(
                {
                  worlds: s.worlds,
                  planner: s.characterPlannerFor(s.ownerId, parsedWorldId.data),
                  now: () => new Date().toISOString(),
                  storyNow: (realNow) => projectStoryTime(clock, realNow),
                  newId: () => crypto.randomUUID(),
                  memories: (actorId) => s.actorMemories(s.ownerId, actorId, parsedWorldId.data),
                },
                { userId: s.ownerId },
                {
                  id: input.commandId,
                  worldId: parsedWorldId.data,
                  expectedVersion: input.expectedVersion,
                  actorId: input.actorId,
                  text: input.text,
                },
              );
              try {
                await s.story.progress(s.ownerId, parsedWorldId.data);
              } catch {
                console.warn(JSON.stringify({ scope: 'story-message-reconcile', code: 'FAILED' }));
              }
              try {
                startCommittedMedia(s.db, s.ownerId, parsedWorldId.data, result.event.id);
              } catch (error) {
                console.warn(
                  JSON.stringify({
                    scope: 'outbox-drain',
                    code: (error as { code?: string })?.code ?? 'FAILED',
                  }),
                );
              }
              const baseReceipt = {
                status: 'committed' as const,
                commandId: input.commandId,
                worldId: result.state.id,
                actorId: input.actorId,
                version: result.state.version,
                eventId: result.event.id,
              };
              if (projectionVersion === WORLD_MESSAGE_PROJECTION_VERSION) {
                const messages = result.state.messages
                  .filter(
                    (m) =>
                      m.sourceEventId === result.event.id &&
                      m.actorId === input.actorId &&
                      (m.role === 'user' || m.role === 'assistant'),
                  )
                  .map((m) => ({
                    id: m.id,
                    actorId: m.actorId,
                    role: m.role as 'user' | 'assistant',
                    text: m.text,
                    at: m.at,
                    sourceEventId: result.event.id,
                    sourceVersion: result.state.version,
                  }));
                return { ...baseReceipt, messages };
              }
              return baseReceipt;
            });
            const clientReceipt = worldMessageClientReceipt(
              WorldMessageReceiptSchema.parse(legacyReceipt),
              projectionVersion,
            );
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: 'complete', receipt: clientReceipt }) + '\n'),
            );
            controller.close();
          } catch (error) {
            if (error instanceof NpcMessageError) {
              context.reportFailure(error, error.status, error.apiCode);
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: 'error',
                    error: {
                      code: error.apiCode,
                      message: error.message,
                      retryable: error.retryable,
                      requestId: context.requestId,
                    },
                  }) + '\n',
                ),
              );
              controller.close();
              return;
            }
            const failure = await httpFailureResponse(error, context).json();
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: 'error', ...failure }) + '\n'),
            );
            controller.close();
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Each execution entry checks ownership and existence itself. Do not hydrate
    // the complete phone projection a second time before accepting the turn.
    try {
      const receipt = await s.npcAgents.sendMessageIfEnabled(s.ownerId, {
        id: input.commandId,
        worldId: parsedWorldId.data,
        expectedVersion: input.expectedVersion,
        actorId: input.actorId,
        text: input.text,
      });
      if (receipt) {
        try {
          startCommittedMedia(s.db, s.ownerId, parsedWorldId.data, receipt.eventId);
        } catch (error) {
          console.warn(
            JSON.stringify({
              scope: 'outbox-drain',
              code: (error as { code?: string })?.code ?? 'FAILED',
            }),
          );
        }
        if (projectionVersion === WORLD_MESSAGE_PROJECTION_VERSION) {
          const messages = await s.npcAgents.readCommittedTurnMessages?.(s.ownerId, receipt);
          const metrics = s.npcAgents.readTurnMetrics?.(input.commandId);
          const streamData = await s.npcAgents.readStreamSegments?.(
            s.ownerId,
            parsedWorldId.data,
            input.commandId,
          );
          return json(
            worldMessageClientReceipt(
              WorldMessageReceiptSchema.parse({
                ...receipt,
                ...(messages ? { messages } : {}),
                ...(metrics ? { metrics } : {}),
                ...(streamData?.summary
                  ? { streamSummary: toContractStreamSummary(streamData.summary) }
                  : {}),
              }),
              projectionVersion,
            ),
          );
        }
        return json(
          worldMessageClientReceipt(WorldMessageReceiptSchema.parse(receipt), projectionVersion),
        );
      }
    } catch (error) {
      if (error instanceof NpcMessageError) {
        context.reportFailure(error, error.status, error.apiCode);
        return json(
          {
            error: {
              code: error.apiCode,
              message: error.message,
              retryable: error.retryable,
              requestId: context.requestId,
            },
          },
          error.status,
        );
      }
      throw error;
    }
    return s.withWorldActivityLock(parsedWorldId.data, async () => {
      const clock = await s.readWorldClock(s.ownerId, parsedWorldId.data);
      const result = await resolveTurn(
        {
          worlds: s.worlds,
          planner: s.characterPlannerFor(s.ownerId, parsedWorldId.data),
          now: () => new Date().toISOString(),
          storyNow: (realNow) => projectStoryTime(clock, realNow),
          newId: () => crypto.randomUUID(),
          memories: (actorId) => s.actorMemories(s.ownerId, actorId, parsedWorldId.data),
        },
        { userId: s.ownerId },
        {
          id: input.commandId,
          worldId: parsedWorldId.data,
          expectedVersion: input.expectedVersion,
          actorId: input.actorId,
          text: input.text,
        },
      );
      try {
        // Reconcile only already committed character output: an invitation or a later
        // explicit mention of an authored place may complete a pending story disclosure.
        // The saved message remains valid if this retryable projection fails.
        await s.story.progress(s.ownerId, parsedWorldId.data);
      } catch {
        console.warn(JSON.stringify({ scope: 'story-message-reconcile', code: 'FAILED' }));
      }
      /*
      回合已提交，立刻把该人生待执行的 outbox 任务派发出去（例如索图产生的
      媒体请求）。派发失败不影响已提交的结果：outbox 是持久的，稍后可再派发。
    */
      try {
        startCommittedMedia(s.db, s.ownerId, parsedWorldId.data, result.event.id);
      } catch (error) {
        console.warn(
          JSON.stringify({
            scope: 'outbox-drain',
            code: (error as { code?: string })?.code ?? 'FAILED',
          }),
        );
      }
      const baseReceipt = {
        status: 'committed' as const,
        commandId: input.commandId,
        worldId: result.state.id,
        actorId: input.actorId,
        version: result.state.version,
        eventId: result.event.id,
      };
      if (projectionVersion === WORLD_MESSAGE_PROJECTION_VERSION) {
        const messages = result.state.messages
          .filter(
            (m) =>
              m.sourceEventId === result.event.id &&
              m.actorId === input.actorId &&
              (m.role === 'user' || m.role === 'assistant'),
          )
          .map((m) => ({
            id: m.id,
            actorId: m.actorId,
            role: m.role as 'user' | 'assistant',
            text: m.text,
            at: m.at,
            sourceEventId: result.event.id,
            sourceVersion: result.state.version,
          }));
        return json(
          worldMessageClientReceipt(
            WorldMessageReceiptSchema.parse({ ...baseReceipt, messages }),
            projectionVersion,
          ),
        );
      }
      return json(
        worldMessageClientReceipt(WorldMessageReceiptSchema.parse(baseReceipt), projectionVersion),
      );
    });
  });
}
