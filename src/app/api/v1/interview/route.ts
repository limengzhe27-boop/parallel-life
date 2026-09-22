import { authenticated, endpoint, json } from '../../../../server/http.ts';
import { requestLimit } from '../../../../server/limits.ts';
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    return json(await s.interview.get(s.ownerId));
  });
}
