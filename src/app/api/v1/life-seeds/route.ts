import { authenticated, endpoint, json, parseBody } from '../../../../server/http.ts';
import { requestLimit } from '../../../../server/limits.ts';
import { SeedRequestSchema } from '../../../../contracts/seeds.ts';
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return json(await s.seeds.list(s.ownerId));
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    return json(await s.seeds.approve(s.ownerId, await parseBody(request, SeedRequestSchema)), 201);
  });
}
