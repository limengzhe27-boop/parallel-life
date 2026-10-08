import { GroupMessageRequestSchema } from '../../../../../../../../contracts/world-experiences.ts';
import { Id } from '../../../../../../../../contracts/api.ts';
import { z } from 'zod';
import {
  authenticated,
  endpoint,
  json,
  HttpError,
  parseBody,
} from '../../../../../../../../server/http.ts';
import {
  getGroupServices,
  runGroupOwnedTask,
} from '../../../../../../../../server/group-services.ts';
import { requestLimit } from '../../../../../../../../server/limits.ts';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; groupId: string }> },
) {
  return endpoint(async () => {
    const s = await authenticated(request),
      p = await context.params;
    if (!Id.safeParse(p.id).success || !Id.safeParse(p.groupId).success)
      throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, GroupMessageRequestSchema);
    if (input.conversationId !== p.groupId) throw new HttpError('INVALID_INPUT', 422);
    return json(
      await getGroupServices().send(s.ownerId, {
        worldId: p.id,
        groupId: p.groupId,
        commandId: input.commandId,
        expectedVersion: input.expectedVersion,
        text: input.text,
      }),
      202,
    );
  });
}
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; groupId: string }> },
) {
  return endpoint(async () => {
    const s = await authenticated(request),
      p = await context.params;
    if (!Id.safeParse(p.id).success || !Id.safeParse(p.groupId).success)
      throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, z.strictObject({ taskId: Id }));
    await requestLimit(s.db, s.ownerId);
    await runGroupOwnedTask(s.ownerId, p.id, p.groupId, input.taskId);
    return json(await s.tasks.get(s.ownerId, input.taskId));
  });
}
