import {
  authenticated,
  endpoint,
  json,
  parseBody,
  HttpError,
} from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { Id } from '../../../../../../contracts/api.ts';
import { ConfirmDraftSchema } from '../../../../../../contracts/life-drafts.ts';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const id = Id.safeParse((await context.params).id);
    if (!id.success) throw new HttpError('INVALID_INPUT', 422);
    await requestLimit(s.db, s.ownerId);
    return json(
      await s.drafts.confirm(s.ownerId, id.data, await parseBody(request, ConfirmDraftSchema)),
    );
  });
}
