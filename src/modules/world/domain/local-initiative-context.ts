import type { ActorAgentState, AgentActionResult, AgentSource } from './agent-runtime.ts';
import type { Appointment } from './types.ts';

/** A new clock window is scheduling capacity, never new evidence to buy the same thought. */
export function localInitiativeContext(input: {
  state: ActorAgentState;
  sources: readonly AgentSource[];
  observations: readonly {
    sourceId: string;
    text: string;
    kind: string;
    speaker?: { kind: 'player' } | { kind: 'actor'; actorId: string };
  }[];
  results: readonly AgentActionResult[];
  appointments: readonly Appointment[];
}) {
  const sources = new Map(input.sources.map((source) => [source.id, source]));
  // Retrieval/processing timestamps and wake receipt IDs are not changes in an NPC's life.
  // Plans already have a structured representation below, not a prose echo in observations.
  const observations = input.observations
    .filter(
      (o) =>
        o.kind !== 'plan' &&
        sources.get(o.sourceId)?.kind !== 'accepted_input' &&
        !(o.speaker?.kind === 'actor' && o.speaker.actorId === input.state.actorId),
    )
    .map((o) => ({ sourceId: o.sourceId, kind: o.kind, text: o.text, speaker: o.speaker }))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const semanticItems = (items: readonly unknown[]) =>
    items
      .map((item) => {
        const { revision: _revision, ...value } = item as Record<string, unknown>;
        return value;
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    definitionRef: input.state.definitionRef,
    observations,
    goals: semanticItems(input.state.goals),
    plans: semanticItems(input.state.plans),
    actions: semanticItems(input.state.actions),
    responsibilities: semanticItems(input.state.responsibilities),
    decisions: semanticItems(input.state.decisions),
    questions: semanticItems(input.state.questions ?? []),
    results: [...input.results].sort((a, b) => a.id.localeCompare(b.id)),
    appointments: [...input.appointments].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Existing server-bound continuation is the consumption receipt for legacy quiet contexts too. */
export function localContinuationSettled(
  input: Parameters<typeof localInitiativeContext>[0],
  stateBasisHash: string,
): boolean {
  const c = input.state.continuation;
  if (
    !c ||
    !['no_current_intent', 'await_response'].includes(c.decision) ||
    c.basisHash !== stateBasisHash
  )
    return false;
  const decidedAt = Date.parse(c.decidedAt);
  if (!Number.isFinite(decidedAt)) return false;
  const sources = new Map(input.sources.map((s) => [s.id, s]));
  const newObservation = input.observations.some(
    (o) =>
      o.kind !== 'plan' &&
      !(o.speaker?.kind === 'actor' && o.speaker.actorId === input.state.actorId) &&
      sources.get(o.sourceId)?.kind !== 'accepted_input' &&
      Date.parse(sources.get(o.sourceId)?.at ?? '') > decidedAt,
  );
  return !newObservation && !input.results.some((r) => Date.parse(r.at) > decidedAt);
}
