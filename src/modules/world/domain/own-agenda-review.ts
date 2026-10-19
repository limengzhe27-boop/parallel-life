import type { AgentInputReceipt } from './agent-runtime.ts';

/** A server wake is a permission to reconsider, never a player request or an executed action. */
export type OwnAgendaReviewEnvelope = {
  type: 'npc_agenda_review';
  family: 'own_agenda';
  grantId: string;
  anchorAttemptId: string;
  policyVersion: string;
  basisSourceIds: string[];
};
export function isOwnAgendaReviewInput(input: Pick<AgentInputReceipt, 'origin' | 'text'>): boolean {
  if (input.origin !== 'wake') return false;
  try {
    return JSON.parse(input.text)?.type === 'npc_agenda_review';
  } catch {
    return false;
  }
}
