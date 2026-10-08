import { Id } from '../../../../../../../contracts/api.ts';
import { z } from 'zod';
import {
  authenticated,
  endpoint,
  json,
  HttpError,
  parseBody,
} from '../../../../../../../server/http.ts';
import { getGroupServices } from '../../../../../../../server/group-services.ts';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; groupId: string }> },
) {
  return endpoint(async () => {
    const s = await authenticated(request),
      p = await context.params;
    if (!Id.safeParse(p.id).success || !Id.safeParse(p.groupId).success)
      throw new HttpError('NOT_FOUND', 404);
    return json(await getGroupServices().read(s.ownerId, p.id, p.groupId));
  });
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; groupId: string }> },
) {
  return endpoint(async () => {
    const s = await authenticated(request),
      p = await context.params;
    if (!Id.safeParse(p.id).success || !Id.safeParse(p.groupId).success)
      throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(
      request,
      z.strictObject({ throughVersion: z.number().int().positive() }),
    );
    return json(
      await getGroupServices().markRead(s.ownerId, p.id, p.groupId, input.throughVersion),
    );
  });
}
