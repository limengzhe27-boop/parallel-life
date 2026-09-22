import { authenticated, endpoint, json, parseBody } from '../../../../server/http.ts';
import { requestLimit } from '../../../../server/limits.ts';
import { WorldBuildRequestSchema } from '../../../../contracts/world-build.ts';
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return json(await s.builds.list(s.ownerId));
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    return json(
      await s.builds.create(s.ownerId, await parseBody(request, WorldBuildRequestSchema)),
      202,
    );
  });
}
