import { after } from 'next/server';
import { runCommittedChatMedia } from './chat-media-tasks.ts';
import { resolveTurn } from '../modules/world/application/resolve-turn.ts';
import { NpcMessageError } from './npc-agent-services.ts';
import {
  WorldMessageRequestSchema,
  WorldMessageReceiptSchema,
} from '../contracts/world-interaction.ts';
import { Id } from '../contracts/api.ts';
import { projectStoryTime } from '../modules/world/domain/clock.ts';
import { authenticated, endpoint, HttpError, json, parseBody } from './http.ts';

export async function worldMessageRoute(request: Request, worldId: string) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const parsedWorldId = Id.safeParse(worldId);
    if (!parsedWorldId.success) throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, WorldMessageRequestSchema);
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
          after(() => runCommittedChatMedia(s.db, s.ownerId, parsedWorldId.data, receipt.eventId));
        } catch (error) {
          console.warn(
            JSON.stringify({
              scope: 'outbox-drain',
              code: (error as { code?: string })?.code ?? 'FAILED',
            }),
          );
        }
        return json(WorldMessageReceiptSchema.parse(receipt));
      }
    } catch (error) {
      if (error instanceof NpcMessageError)
        return json(
          {
            error: {
              code: error.apiCode,
              message: error.message,
              retryable: error.retryable,
              requestId: crypto.randomUUID(),
            },
          },
          error.status,
        );
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
        after(() => runCommittedChatMedia(s.db, s.ownerId, parsedWorldId.data, result.event.id));
      } catch (error) {
        console.warn(
          JSON.stringify({
            scope: 'outbox-drain',
            code: (error as { code?: string })?.code ?? 'FAILED',
          }),
        );
      }
      return json(
        WorldMessageReceiptSchema.parse({
          status: 'committed',
          commandId: input.commandId,
          worldId: result.state.id,
          actorId: input.actorId,
          version: result.state.version,
          eventId: result.event.id,
        }),
      );
    });
  });
}
