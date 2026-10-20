import type { ActorAgentState } from '../domain/agent-runtime.ts';
import type { Id, WorldState } from '../domain/types.ts';

/**
 * The exact world fields the private-chat context builder consumes. A bounded
 * reader may return this shape without pretending it is a complete WorldState:
 * messages/facts/appointments are selected, not exhaustive, and the
 * completeness block states the selection that was actually made.
 */
export const CHAT_CONTEXT_FULL_HYDRATE_REQUIRED = 'CHAT_CONTEXT_FULL_HYDRATE_REQUIRED';

export type ChatContextFallbackReason =
  | 'attendance'
  | 'invitation-reconciliation'
  | 'explicit-reference-limit'
  | 'state-reference-limit'
  | 'linked-evidence-limit';

/** The bounded reader could not prove complete, source-correct input; caller must use full hydrate. */
export class ChatContextFallbackError extends Error {
  readonly code = CHAT_CONTEXT_FULL_HYDRATE_REQUIRED;
  readonly reason: ChatContextFallbackReason;
  constructor(reason: ChatContextFallbackReason) {
    super(`${CHAT_CONTEXT_FULL_HYDRATE_REQUIRED}:${reason}`);
    this.name = 'ChatContextFallbackError';
    this.reason = reason;
  }
}

export type PrivateChatWorld = Pick<
  WorldState,
  | 'id'
  | 'ownerId'
  | 'version'
  | 'title'
  | 'time'
  | 'actors'
  | 'messages'
  | 'facts'
  | 'appointments'
  | 'matters'
  | 'choices'
>;

export type ChatContextCompleteness = {
  /** Compact `worlds.state` is authoritative for identity, actors, matters and choices. */
  world: 'complete_compact_state';
  actorState: 'complete' | 'missing';
  messages: {
    mode: 'authored_opening_plus_bounded_runtime_window_plus_referenced';
    runtimeWindowLimit: number;
    runtimeWindowHasMore: boolean;
    openingCount: number;
    runtimeCount: number;
    referencedCount: number;
    unresolvedReferencedIds: string[];
  };
  facts: {
    mode: 'authored_genesis_plus_recent_plus_matter_linked_plus_referenced';
    recentLimit: number;
    recentHasMore: boolean;
    initialCount: number;
    runtimeCount: number;
  };
  appointments: {
    mode: 'active_complete_plus_recent_terminal_plus_referenced';
    activeCount: number;
    terminalLimit: number;
    terminalHasMore: boolean;
    initialCount: number;
    runtimeCount: number;
  };
  matters: 'complete_visible_to_actor_from_compact_state';
  choices: 'complete_actor_choices_from_compact_state';
  /**
   * Media results are not loaded here. The existing media-result reader remains
   * required so an old completed/failed/pending result is never inferred from
   * this bounded world. Explicit `media-result:`/`action-result:` handles are
   * returned in `referenced.deferredToExistingResolver`.
   */
  mediaResults: 'not_loaded_existing_media_result_resolver_remains_required';
  /**
   * Worlds with historical scene-attendance events need the existing full
   * appointment replay. The bounded reader throws
   * CHAT_CONTEXT_FULL_HYDRATE_REQUIRED instead of silently using a stale
   * projection; the caller keeps its old full-hydrate path for those worlds.
   */
  attendanceReplay: 'bounded_reader_throws_when_required';
  /** Notes are not part of NPC private-chat context and are intentionally absent. */
  notes: 'not_loaded_not_used_by_private_chat_context';
  referenced: {
    explicitRequested: string[];
    explicitResolved: string[];
    explicitUnresolved: string[];
    /** message/fact/appointment handles required by the actor's durable state. */
    stateRequired: string[];
    stateResolved: string[];
    stateUnresolved: string[];
    deferredToExistingResolver: string[];
  };
};

export type ChatContextRead = {
  world: PrivateChatWorld;
  actorState: ActorAgentState | null;
  completeness: ChatContextCompleteness;
};

export type ChatContextReadInput = {
  worldId: Id;
  actorId: Id;
  /**
   * Exact source handles explicitly referenced by the caller (for example a
   * replied-to message, a saved fact, an old appointment, or a media result).
   * Handles used by the actor's own durable state are added automatically.
   */
  referencedSourceIds?: readonly string[];
  /** Bounded recent runtime-message window; defaults to 200, max 500. */
  runtimeWindowLimit?: number;
  /** Bounded recent fact window; defaults to 80, max 200. */
  recentFactLimit?: number;
  /** Bounded recent terminal appointments; defaults to 20, max 50. */
  terminalAppointmentLimit?: number;
};
