import { authenticated, endpoint, HttpError, json, parseBody } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';
import {
  MemoryCandidateDecisionSchema,
  MemoryCandidateFromBranchSchema,
  MemoryCandidateStatusSchema,
} from '../../../../../contracts/memory.ts';
import { z } from 'zod';

const MemoryCandidateCommandSchema = z.union([
  MemoryCandidateDecisionSchema,
  MemoryCandidateFromBranchSchema,
]);

export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    const statusValue = new URL(request.url).searchParams.get('status');
    const parsedStatus = statusValue
      ? MemoryCandidateStatusSchema.safeParse(statusValue)
      : undefined;
    if (parsedStatus && !parsedStatus.success) throw new HttpError('INVALID_INPUT', 422);
    const status = parsedStatus?.success ? parsedStatus.data : undefined;
    return json({ candidates: await s.memoryCandidates.list(s.ownerId, status) });
  });
}

export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    const input = await parseBody(request, MemoryCandidateCommandSchema);
    const candidate =
      'branchMemoryId' in input
        ? await s.memoryCandidates.createFromBranch(s.ownerId, input)
        : input.action === 'confirm'
          ? await s.memoryCandidates.confirm(s.ownerId, input.candidateId, input.commandId)
          : await s.memoryCandidates.reject(s.ownerId, input.candidateId, input.commandId);
    return json({ candidate });
  });
}
