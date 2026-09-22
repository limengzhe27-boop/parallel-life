import { authenticated, endpoint, json, parseBody } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';
import { InterviewSendSchema } from '../../../../../contracts/api.ts';
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    return json(
      await s.interview.send(s.ownerId, await parseBody(request, InterviewSendSchema)),
      202,
    );
  });
}
