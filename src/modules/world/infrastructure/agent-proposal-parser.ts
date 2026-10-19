import { attachAgentFailure } from '../application/agent-failure-diagnostic.ts';
import { AgentProposalSchema } from './agent-proposal-schema.ts';
import { decodeNpcWire } from './npc-model-protocol.ts';
import type { AgentProposal } from '../domain/agent-runtime.ts';
import {
  AgentValidationError,
  validateAgentProposal,
  type AgentValidationContext,
} from '../domain/agent-kernel.ts';
/** Keep the coarse reason stable while adding just enough detail to diagnose a bad model reply. */
export function describeShapeIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  limit = 3,
): string {
  return issues
    .slice(0, limit)
    .map((issue) => {
      const path = issue.path
        .filter(
          (part): part is string | number => typeof part === 'string' || typeof part === 'number',
        )
        .join('.');
      return `${path || '(root)'}=${issue.message}`;
    })
    .join('|');
}

const reject = (reason: string): never => {
  throw new AgentValidationError(reason);
};
/** Strict public model protocol; no regex-based dialogue-to-physical-execution inference. */
export function parseAgentProposal(context: AgentValidationContext, raw: unknown): AgentProposal {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 180000) reject('RESPONSE_LIMIT');
    try {
      parsed = JSON.parse(raw);
    } catch {
      reject('RESPONSE_JSON');
    }
  }
  try {
    parsed = decodeNpcWire(context, parsed);
  } catch (error) {
    throw attachAgentFailure(
      new AgentValidationError('RESPONSE_WIRE_SHAPE'),
      'decode',
      undefined,
      error,
    );
  }
  const result = AgentProposalSchema.safeParse(parsed);
  if (!result.success) reject(`RESPONSE_SHAPE:${describeShapeIssues(result.error.issues)}`);
  const proposal = result.data!;
  validateAgentProposal(context, proposal);
  return proposal;
}
