import { authenticated, endpoint, json } from '../../../../../server/http.ts';
import { Id } from '../../../../../contracts/api.ts';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return json(await s.builds.phone(s.ownerId, Id.parse((await context.params).id)));
  });
}
