import { AgentProposalSchema } from './agent-proposal-schema.ts';
import { decodeNpcWire } from './npc-model-protocol.ts';
import type { AgentProposal } from '../domain/agent-runtime.ts';
import {
  AgentValidationError,
  validateAgentProposal,
  type AgentValidationContext,
} from '../domain/agent-kernel.ts';
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
  } catch {
    reject('RESPONSE_WIRE_SHAPE');
  }
  const result = AgentProposalSchema.safeParse(parsed);
  if (!result.success) reject('RESPONSE_SHAPE');
  const proposal = result.data!;
  validateAgentProposal(context, proposal);
  return proposal;
}
