import { authenticated, endpoint, json, parseBody } from '../../../../server/http.ts';
import { requestLimit } from '../../../../server/limits.ts';
import { DiscoverRequestSchema } from '../../../../contracts/discovery.ts';
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return json(await s.discovery.get(s.ownerId));
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    return json(
      await s.discovery.generate(s.ownerId, await parseBody(request, DiscoverRequestSchema)),
      202,
    );
  });
}
