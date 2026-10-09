import { authenticated, endpoint, HttpError, json } from '../../../../../../server/http.ts';
import { Id } from '../../../../../../contracts/api.ts';
export const runtime = 'nodejs';
/** Player direction editing is retired. Internal director/clock stores remain unchanged. */
async function disabled(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    await authenticated(request);
    if (!Id.safeParse((await context.params).id).success) throw new HttpError('NOT_FOUND', 404);
    // Do not read a world, parse a director brief, invoke a model or write any history.
    return json(
      {
        error: {
          code: 'INVALID_COMMAND',
          message: '进入人生后不再提供导演修改。时间管理和切换人生仍可使用。',
          retryable: false,
        },
      },
      410,
    );
  });
}
export const GET = disabled;
export const POST = disabled;
