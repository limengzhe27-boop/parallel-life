import type { AgentProposal, AgentActionResult, ActorAgentState } from './agent-runtime.ts';
import type { WorldState } from './types.ts';
import { DomainError } from './errors.ts';
import { isoInstant, validateEventId } from './validation.ts';

export type AgentRuntimeTransition = {
  schemaVersion: 1;
  engineEpoch: number;
  inputReceiptId: string;
  actorRevisionBefore: number;
  actorRevisionAfter: number;
  proposal: AgentProposal;
  results: AgentActionResult[];
  /** Immutable accepted revision for exact receipt replay and explicit state migration. */
  stateAfter: ActorAgentState;
};
/** A real private plan/state transition can commit without fabricating a message. */
export type AgentStateCommittedEvent = {
  schemaVersion: 1;
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  type: 'agent.state_committed';
  data: { actorId: string; agentRuntime: AgentRuntimeTransition };
};
export function applyAgentStateEvent(
  current: WorldState,
  event: AgentStateCommittedEvent,
): WorldState {
  if (event.worldId !== current.id || event.version !== current.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  validateEventId(event.id);
  validateEventId(event.commandId);
  isoInstant(event.occurredAt);
  isoInstant(event.storyAt);
  if (
    event.schemaVersion !== 1 ||
    !current.actors.some((actor) => actor.id === event.data.actorId) ||
    event.data.agentRuntime.schemaVersion !== 1 ||
    event.data.agentRuntime.engineEpoch < 2 ||
    event.data.agentRuntime.actorRevisionAfter !==
      event.data.agentRuntime.actorRevisionBefore + 1 ||
    Date.parse(event.storyAt) < Date.parse(current.time) ||
    event.data.agentRuntime.proposal.statements.length > 0
  )
    throw new DomainError('INVALID_PROPOSAL');
  // This event changes durable NPC execution state; it cannot invent phone messages, arrivals or external results.
  return { ...structuredClone(current), version: event.version, time: event.storyAt };
}
