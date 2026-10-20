import type { AgentAction, AgentPlan } from './agent-runtime.ts';

/** Describes recorded intent only; never invents an action, condition or completion. */
export function agentPlanNextStep(
  plan: AgentPlan,
  actions: readonly AgentAction[],
  allowedCapabilities: readonly string[],
): 'closed' | 'action' | 'unsupported' | 'reconsider' | 'waiting' | 'missing_next_step' {
  if (plan.status === 'finished' || plan.status === 'withdrawn') return 'closed';
  if (plan.nextActionId) {
    const action = actions.find((a) => a.id === plan.nextActionId);
    if (!action || !plan.actionIds.includes(action.id)) return 'missing_next_step';
    if (['succeeded', 'failed'].includes(action.status)) return 'reconsider';
    return allowedCapabilities.includes(action.capability) ? 'action' : 'unsupported';
  }
  if (plan.actionIds.length) return 'missing_next_step';
  if (plan.triggers.length) return 'reconsider';
  return plan.missingConditions.length ? 'waiting' : 'missing_next_step';
}
