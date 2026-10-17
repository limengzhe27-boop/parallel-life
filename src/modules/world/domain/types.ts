import type { WorldMatter, MatterStatus, MatterAssertion, MatterEvidence } from './matters.ts';

/** Persisted contracts are versioned; timestamps are ISO 8601, all instants UTC. */
export type Id = string;
export type Session = { userId: Id };
export type Visibility = { kind: 'owner' } | { kind: 'actors'; actorIds: Id[] } | { kind: 'world' };

export type Actor = {
  id: Id;
  name: string;
  persona: string;
  relationship?: string;
  sourcePersonId?: Id;
  initialPlaceId?: string;
};
/** A directed, bounded social link. mayShare means possible, never mandatory. */
export type ActorTie = { fromActorId: Id; toActorId: Id; relationship: string; mayShare: boolean };
export type Fact = {
  id: Id;
  text: string;
  visibility: Visibility;
  sourceEventId: Id;
  /** Absent only for legacy records; absence must not be interpreted as confirmed truth. */
  kind?: 'canonical' | 'belief';
  believedByActorId?: Id;
  /** A sourced, character-private account of how this person heard a player's line. */
  disclosure?: { fromActorId: Id; sourceMessageId: Id; quote: string };
  /** Witnessed departure observation metadata. */
  departure?: { fromPlaceName: string; eventVersion: number };
};
export type Message = {
  id: Id;
  actorId: Id;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  sourceEventId: Id;
  attachment?: { kind: 'image' | 'video'; assetId: Id; label?: string };
  /** Immutable initial read state; later browser reads remain a separate projection. */
  initialRead?: boolean;
  history?: { version: 1; key: string; replyToMessageId?: Id };
  /** Internal event ordering for deciding whether a later reply has addressed a choice. */
  sourceVersion?: number;
};
export type Appointment = {
  /** Legacy records have no explicit response state. */
  status?: 'proposed' | 'confirmed' | 'cancelled' | 'attended' | 'missed';
  /** Story instant of the owner's latest explicit decision, never inferred from NPC text. */
  responseAt?: string;
  responseVersion?: number;
  id: Id;
  title: string;
  at: string;
  participantIds: Id[];
  sourceEventId: Id;
  sourceMessageId?: Id;
  placeId?: Id;
};
export type MediaRequest = {
  id: Id;
  prompt: string;
  title?: string;
  status: 'pending' | 'ready' | 'failed' | 'unknown';
  assetId?: Id;
  errorCode?: string;
  sourceEventId: Id;
  mediaType?: 'image' | 'video';
  deliveryDecision?: {
    deliverToChat: boolean;
    deliverToAlbum: boolean;
    reason?: string;
  };
};
/**
 * A phone note the user saved. Notes live in their own projection table rather
 * than in the world snapshot, so the snapshot stays small as a life continues.
 */
export type Note = {
  id: Id;
  title: string;
  text: string;
  /** Per-note version; unrelated to the world version, which also advances. */
  version: number;
  updatedAt: string;
  sourceEventId: Id;
};

/** An authoritative physical or informational item held by an actor or player. */
export type WorldItem = {
  id: Id;
  title: string;
  kind?: 'document' | 'prop' | 'gift' | 'token';
  holderActorId: Id;
  sourceEventId: Id;
  transferredAt?: string;
  note?: string;
};

/** A decision the protagonist actually stated, not a result inferred from an NPC reply. */
export type StoryChoice = {
  id: Id;
  actorId: Id;
  quote: string;
  intent: string;
  sourceEventId: Id;
  sourceVersion: number;
  status: 'pending' | 'followed_up' | 'superseded';
  followUpEventId?: Id;
  /** An actor's own actionable proposal, quoted from a committed reply; not a completed action. */
  nextStep?: {
    quote: string;
    sourceEventId: Id;
    sourceMessageId: Id;
    sourceVersion: number;
  };
  /** This actor's proposal after the player reported a setback, not an adopted action. */
  recoveryStep?: {
    quote: string;
    sourceEventId: Id;
    sourceMessageId: Id;
    sourceVersion: number;
  };
  /** The player's account of the outcome, never an independently verified world fact. */
  result?: {
    kind: 'reported_done' | 'blocked' | 'abandoned';
    quote: string;
    sourceEventId: Id;
    sourceVersion: number;
    acknowledgedEventId?: Id;
  };
};

export type GenesisLinks = {
  version: 1;
  seedId: Id;
  entries: {
    id: Id;
    messageId: Id;
    actorId: Id;
    quote: string;
    invitationId?: Id;
  }[];
};
export type WorldState = {
  space?: import('./space.ts').WorldSpaceState;
  /** Immutable public editorial material; never the full director script. */
  officialLife?: {
    presetId: string;
    version: number;
    contacts: { actorId: string; relationship: string }[];
    notes: { key: string; title: string; text: string }[];
  };
  genesisLinks?: GenesisLinks;
  schemaVersion: 1;
  id: Id;
  ownerId: Id;
  version: number;
  title: string;
  time: string;
  /** Absent for legacy worlds. Fixed UTC+08 follows the existing phone time policy. */
  messageHistory?: { version: 1; startAt: string; timeZone: 'UTC+08:00' };
  actors: Actor[];
  /** Absent in old worlds: no unproven contact may be assumed for new disclosures. */
  actorTies?: ActorTie[];
  facts: Fact[];
  messages: Message[];
  appointments: Appointment[];
  mediaRequests: MediaRequest[];
  /** Absent means no persisted notes yet; opening notes come from the build snapshot. */
  notes?: Note[];
  /** Bounded active/recent decisions; absent for worlds created before this feature. */
  choices?: StoryChoice[];
  /** Cross-scene near-term matters and life pursuits. */
  matters?: WorldMatter[];
  /** Authoritative tracked items held by actors; absent in legacy snapshots. */
  items?: WorldItem[];
};

export type WorldEffect =
  | { type: 'belief.recorded'; id: Id; actorId: Id; text: string }
  | { type: 'information.shared'; id: Id; recipientActorId: Id; sourceMessageId: Id; quote: string }
  | {
      type: 'appointment.proposed';
      id: Id;
      title: string;
      at: string;
      participantIds: Id[];
      placeId?: string;
    }
  | { type: 'message.received'; id: Id; actorId: Id; text: string }
  | {
      type: 'appointment.fulfilled';
      id: Id;
      appointmentId: Id;
      actorId: Id;
      at: string;
    }
  | {
      type: 'appointment.cancelled';
      id: Id;
      appointmentId: Id;
      actorId: Id;
      at: string;
      reason?: string;
    }
  | {
      type: 'appointment.confirmed';
      id: Id;
      appointmentId: Id;
      actorId: Id;
      at: string;
    }
  | {
      type: 'appointment.rescheduled';
      id: Id;
      appointmentId: Id;
      actorId: Id;
      at: string;
      newAt: string;
      locationId?: string;
      placeId?: string;
      reason?: string;
    }
  | {
      type: 'item.delivered';
      id: Id;
      itemId: Id;
      title?: string;
      fromActorId: Id;
      toActorId: Id;
      placeId?: string;
      at: string;
      note?: string;
    }
  | { type: 'appointment.created'; id: Id; title: string; at: string; participantIds: Id[] }
  | { type: 'fact.established'; id: Id; text: string; visibility: Visibility }
  | {
      type: 'media.requested';
      id: Id;
      prompt: string;
      title?: string;
      mediaType?: 'image' | 'video';
    }
  | { type: 'choice.recorded'; id: Id; quote: string; intent: string }
  | { type: 'choice.next_step'; id: Id; choiceId: Id; quote: string }
  | { type: 'choice.recovery_step'; id: Id; choiceId: Id; quote: string }
  | {
      type: 'choice.result_reported';
      id: Id;
      choiceId: Id;
      quote: string;
      outcome: 'reported_done' | 'blocked' | 'abandoned';
    }
  | {
      type: 'matter.proposed';
      id: Id;
      title: string;
      description: string;
      span: 'near_term' | 'pursuit';
      quote: string;
    }
  | { type: 'matter.created'; id: Id; matter: WorldMatter }
  | {
      type: 'matter.updated';
      id: Id;
      matterId: Id;
      status: MatterStatus;
      evidence: MatterEvidence;
      assertion?: MatterAssertion;
    };

/** Trusted anchors of already presented events; never supplied by a model assessment. */
export type EventGoalSource = {
  sourceEventId: string;
  sourceRecordId: string;
} & (
  | { kind: 'publication_node'; nodeKey: string }
  | { kind: 'matter'; matterId: string }
  | { kind: 'director_event' }
);
/** Private current-speaker direction. This is neither action permission nor a world fact. */
export type ActorEventGoal = {
  goalKey: string;
  actorId: string;
  source: EventGoalSource;
  want: string;
  stance: string;
  boundaries: string[];
  phase: 'introduced' | 'engaged' | 'resolved';
  /** Shared scheduling phase only; no remote actor decisions or private results. */
  sharedEventPhase?: 'introduced' | 'engaged' | 'resolved';
  status: 'active' | 'deferred' | 'fulfilled' | 'withdrawn';
  participation: 'unknown' | 'engaged' | 'declined';
  refusalScope: 'current_player_request';
  mayPursueOwnGoalWithoutPlayer: true;
  actualMovesRequireRuntimeAuthorization: true;
  pace: 'brief' | 'standard' | 'extended';
  productiveBeats: number;
  segmentIndex: number;
  nextMove:
    | 'wait'
    | 'continue_in_current_turn'
    | 'invite_once'
    | 'advance_without_player'
    | 'seek_closure'
    | 'finished';
};
/** Semantic candidates only. The runtime assigns record/event/actor IDs and completion evidence. */
export type EventGoalAssessment = {
  goalKey: string;
  target: 'user' | 'npc';
  kind: 'engaged' | 'declined' | 'reopened' | 'unrelated' | 'npc_progress' | 'nudge' | 'closure';
  quote: string;
  /** Time expiry and fulfillment require separate verified runtime evidence. */
  closure?: 'withdrawn' | 'alternative' | 'unresolved';
};
/** Director-only actual inputs. These never grant an NPC knowledge of remote activity. */
export type StoryWorldInput = {
  sourceEventId: string;
  version: number;
  storyAt: string;
} & (
  | { kind: 'arrival'; fromPlaceId: string; placeId: string }
  | {
      kind: 'invitation_response';
      invitationId: string;
      operation: 'accept' | 'cancel' | 'attend' | 'miss' | 'reschedule';
    }
  | { kind: 'scene_result'; sceneId: string; outcome: 'succeeded' | 'partial' | 'failed' | null }
);
export type TurnProposal = {
  schemaVersion: 1;
  effects: WorldEffect[];
  eventGoalAssessments?: EventGoalAssessment[];
};
export type TurnCommand = {
  /** Internal orchestration only; public message input does not accept this field. */
  origin?: 'director';
  id: Id;
  worldId: Id;
  expectedVersion: number;
  actorId: Id;
  text: string;
};
export type WorldEvent = {
  schemaVersion: 1;
  id: Id;
  worldId: Id;
  version: number;
  commandId: Id;
  occurredAt: string;
  /** Story instant of the NPC reply; absent on old turns and director beats. */
  storyAt?: string;
  type: 'turn.resolved';
  data: {
    actorId: Id;
    userText: string;
    effects: WorldEffect[];
    origin?: 'director';
    userAt?: string;
    /** New disclosure commits carry v2; absent only on previously stored events. */
    disclosurePolicyVersion?: 2;
    /** Kernel-only persistent NPC transition; never accepted as model-authored world facts. */
    agentRuntime?: import('./agent-state-event.ts').AgentRuntimeTransition;
  };
};
export type OutboxJob = {
  id: Id;
  worldId: Id;
  eventId: Id;
  type: 'image.generate' | 'video.generate';
  requestId: Id;
  prompt: string;
  /** Optional human-facing label for reminder-style jobs. */
  title?: string;
  mediaType?: 'image' | 'video';
};
export type CommitResult = { state: WorldState; event: WorldEvent };
