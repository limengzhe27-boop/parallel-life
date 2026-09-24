import { resolveTurn } from '../../../../../../modules/world/application/resolve-turn.ts';
import {
  WorldMessageRequestSchema,
  WorldMessageReceiptSchema,
} from '../../../../../../contracts/world-interaction.ts';
import { Id } from '../../../../../../contracts/api.ts';
import {
  authenticated,
  endpoint,
  HttpError,
  json,
  parseBody,
} from '../../../../../../server/http.ts';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const parsedWorldId = Id.safeParse((await context.params).id);
    if (!parsedWorldId.success) throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, WorldMessageRequestSchema);
    const result = await resolveTurn(
      {
        worlds: s.worlds,
        planner: s.worldPlanner,
        now: () => new Date().toISOString(),
        newId: () => crypto.randomUUID(),
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
    /*
      回合已提交，立刻把该人生待执行的 outbox 任务派发出去（例如索图产生的
      媒体请求）。派发失败不影响已提交的结果：outbox 是持久的，稍后可再派发。
    */
    try {
      await s.drainOutbox(s.ownerId);
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
}
