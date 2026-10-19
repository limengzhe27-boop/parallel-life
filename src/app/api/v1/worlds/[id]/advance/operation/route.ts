import {
  authenticated,
  endpoint,
  HttpError,
  json,
  parseBody,
} from '../../../../../../../server/http.ts';
import { Id } from '../../../../../../../contracts/api.ts';
import {
  AdvanceOperationRequestSchema,
  AdvanceOperationReceiptSchema,
} from '../../../../../../../contracts/advance-operation.ts';
import { requestLimit } from '../../../../../../../server/limits.ts';
export const runtime = 'nodejs';
export const maxDuration = 240;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async (http) => {
    const s = await authenticated(request),
      world = Id.safeParse((await context.params).id);
    if (!world.success) throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, AdvanceOperationRequestSchema);
    await requestLimit(s.db, s.ownerId);
    return json(
      AdvanceOperationReceiptSchema.parse(
        await s.advanceOperations.perform(
          s.ownerId,
          world.data,
          input.operationId,
          input.action,
          (error) => http.reportFailure(error, 503, 'UNAVAILABLE'),
        ),
      ),
    );
  });
}
