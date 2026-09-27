import { authenticated, endpoint, json, parseBody, HttpError } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';
import { Id } from '../../../../../contracts/api.ts';
import { SaveDraftSchema } from '../../../../../contracts/life-drafts.ts';
type Context = { params: Promise<{ id: string }> };
async function idFor(context: Context) {
  const id = Id.safeParse((await context.params).id);
  if (!id.success) throw new HttpError('INVALID_INPUT', 422);
  return id.data;
}
export async function GET(request: Request, context: Context) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return json(await s.drafts.get(s.ownerId, await idFor(context)));
  });
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    return json(
      await s.drafts.save(
        s.ownerId,
        await idFor(context),
        await parseBody(request, SaveDraftSchema),
      ),
    );
  });
}
