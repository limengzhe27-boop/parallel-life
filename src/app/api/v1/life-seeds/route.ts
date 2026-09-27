import { authenticated, endpoint, json } from '../../../../server/http.ts';
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return json(await s.seeds.list(s.ownerId));
  });
}
