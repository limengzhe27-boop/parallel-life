import { z } from 'zod';
import { ParticipantSchema } from '../../../../../../../../contracts/world-experiences.ts';
import { Id, Version } from '../../../../../../../../contracts/api.ts';
import {
  authenticated,
  endpoint,
  json,
  HttpError,
  parseBody,
} from '../../../../../../../../server/http.ts';
import { getGroupServices } from '../../../../../../../../server/group-services.ts';
const Input = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  action: z.enum(['join', 'leave']),
  participant: ParticipantSchema,
});
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; groupId: string }> },
) {
  return endpoint(async () => {
    const s = await authenticated(request),
      p = await context.params;
    if (!Id.safeParse(p.id).success || !Id.safeParse(p.groupId).success)
      throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, Input);
    return json(
      await getGroupServices().membership(s.ownerId, {
        worldId: p.id,
        groupId: p.groupId,
        ...input,
      }),
    );
  });
}
