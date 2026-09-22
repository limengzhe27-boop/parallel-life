import {
  authenticated,
  endpoint,
  json,
  HttpError,
  parseBody,
} from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { Id, RetryTaskSchema } from '../../../../../../contracts/api.ts';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request),
      { id } = await context.params;
    if (!Id.safeParse(id).success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    const input = await parseBody(request, RetryTaskSchema);
    return json(await s.tasks.retry(s.ownerId, id, input.commandId), 202);
  });
}
