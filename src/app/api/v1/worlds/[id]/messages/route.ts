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
