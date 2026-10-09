import { authenticated, endpoint, HttpError, json, parseBody } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';
import { MemoryEditRequestSchema } from '../../../../../contracts/memory.ts';
export const runtime = 'nodejs';
/** The user's own memories: active first, optionally including superseded/forgotten. */
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    const params = new URL(request.url).searchParams;
    const scopeType = params.get('scopeType') ?? undefined;
    if (scopeType && !['profile', 'branch', 'character'].includes(scopeType))
      throw new HttpError('INVALID_INPUT', 422);
    if (scopeType === 'character') throw new HttpError('FORBIDDEN', 403);
    return json({
      memories: await s.listMemories(s.ownerId, {
        ...(scopeType ? { scopeType: scopeType as 'profile' | 'branch' | 'character' } : {}),
        ...(params.get('scopeId') ? { scopeId: params.get('scopeId')! } : {}),
        includeInactive: params.get('includeInactive') === '1',
      }),
    });
  });
}
/**
 * Correct or forget a memory. This is the user's own action, so it is applied
 * synchronously in one transaction and never inferred by an agent.
 */
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    const input = MemoryEditRequestSchema.parse(await parseBody(request, MemoryEditRequestSchema));
    const record = await s.editMemory(s.ownerId, input);
    return json({
      status: 'committed' as const,
      commandId: input.commandId,
      record: {
        id: record.id,
        scopeType: record.scopeType,
        scopeId: record.scopeId,
        kind: record.kind,
        text: record.text,
        status: record.status,
      },
    });
  });
}
