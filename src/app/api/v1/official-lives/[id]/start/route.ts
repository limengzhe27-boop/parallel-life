import {
  authenticated,
  endpoint,
  json,
  parseBody,
  HttpError,
} from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import {
  OfficialLifeIdSchema,
  OfficialLifeStartRequestSchema,
} from '../../../../../../contracts/official-lives.ts';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const id = OfficialLifeIdSchema.safeParse((await context.params).id);
    if (!id.success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    const result = await s.officialLives.start(
      s.ownerId,
      id.data,
      await parseBody(request, OfficialLifeStartRequestSchema),
    );
    return json(result, result.resumed ? 200 : 201);
  });
}
