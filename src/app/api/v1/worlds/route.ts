import { authenticated, endpoint, json } from '../../../../server/http.ts';
import { WorldListResponseSchema } from '../../../../contracts/life-management.ts';

export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status');
    const status = statusParam === 'all' || statusParam === 'archived' ? statusParam : 'active';
    const worlds = await s.worlds.listUserWorlds(s.ownerId, { status });
    return json(WorldListResponseSchema.parse({ worlds }));
  });
}
