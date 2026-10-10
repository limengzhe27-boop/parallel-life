import { authenticated, endpoint, json } from '../../../../server/http.ts';
import { OfficialLifeListSchema } from '../../../../contracts/official-lives.ts';
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return json(OfficialLifeListSchema.parse(await s.officialLives.list(s.ownerId)));
  });
}
