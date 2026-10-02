import { authenticated, endpoint, json, parseBody, HttpError } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';
import { Id } from '../../../../../contracts/api.ts';
import { SaveSettingDraftSchema } from '../../../../../contracts/setting-drafts.ts';
type Context = { params: Promise<{ id: string }> };
async function idFor(context: Context) {
  const parsed = Id.safeParse((await context.params).id);
  if (!parsed.success) throw new HttpError('INVALID_INPUT', 422);
  return parsed.data;
}
export async function GET(request: Request, context: Context) {
  return endpoint(async () => {
    const s = await authenticated(request),
      id = await idFor(context);
    const raw = new URL(request.url).searchParams.get('version');
    if (raw !== null && !/^(0|[1-9][0-9]?)$/.test(raw)) throw new HttpError('INVALID_INPUT', 422);
    return json(await s.settingDrafts.get(s.ownerId, id, raw === null ? undefined : Number(raw)));
  });
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    return json(
      await s.settingDrafts.save(
        s.ownerId,
        await idFor(context),
        await parseBody(request, SaveSettingDraftSchema),
      ),
    );
  });
}
