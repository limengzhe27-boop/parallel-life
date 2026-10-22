import type { AgentProposal } from './agent-runtime.ts';

/** Explicit player instructions are a safe server-side recall decision, not model prose. */
const ASK = /(撤回|收回|撤销)/u;
const TARGET = /(刚才|刚刚|刚发|上一条|上一句|那句|那条|那条消息|说的话|消息)/u;

export function isExplicitRecallRequest(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 200) return false;
  if (/^(我|他|她|别人|有人|为什么|怎么)/u.test(value)) return false;
  if (!ASK.test(value) || !TARGET.test(value)) return false;
  return value.search(ASK) < value.search(TARGET) || /(一下|吧|帮我|给我|能不能|可以|请|把)/u.test(value);
}

/**
 * The model may choose to recall on its own. This fallback only covers an explicit
 * player instruction in a private player turn and never invents a target message.
 */
export function withRecallRequest(
  proposal: AgentProposal,
  input: { channelKind?: string; origin?: string; text: string },
): AgentProposal {
  if (proposal.recallLast) return proposal;
  if (input.channelKind !== 'private' || input.origin !== 'player') return proposal;
  if (!isExplicitRecallRequest(input.text)) return proposal;
  return { ...proposal, recallLast: true };
}
