import {
  authenticated,
  endpoint,
  json,
  parseBody,
  HttpError,
} from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { Id } from '../../../../../../contracts/api.ts';
import { SettingTrialRequestSchema } from '../../../../../../contracts/setting-drafts.ts';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    const id = Id.safeParse((await context.params).id);
    if (!id.success) throw new HttpError('INVALID_INPUT', 422);
    return json(
      await s.settingTrials.create(
        s.ownerId,
        id.data,
        await parseBody(request, SettingTrialRequestSchema),
      ),
      201,
    );
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const id = Id.safeParse((await context.params).id);
    if (!id.success) throw new HttpError('INVALID_INPUT', 422);
    return json(await s.settingTrials.list(s.ownerId, id.data));
  });
}
