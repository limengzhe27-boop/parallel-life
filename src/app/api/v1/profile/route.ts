import { authenticated, endpoint, json, parseBody } from '../../../../server/http.ts';
import { requestLimit } from '../../../../server/limits.ts';
import { ProfileEditSchema } from '../../../../contracts/api.ts';
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    return json(await s.profile.get(s.ownerId));
  });
}
export async function PATCH(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    return json(await s.profile.edit(s.ownerId, await parseBody(request, ProfileEditSchema)));
  });
}
