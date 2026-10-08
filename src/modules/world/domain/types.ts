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
};
export type Message = {
  id: Id;
  actorId: Id;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  sourceEventId: Id;
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
};
export type MediaRequest = {
  id: Id;
  prompt: string;
  title?: string;
  status: 'pending' | 'ready' | 'failed';
  assetId?: Id;
  errorCode?: string;
  sourceEventId: Id;
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

export type WorldState = {
  schemaVersion: 1;
  id: Id;
  ownerId: Id;
  version: number;
  title: string;
  time: string;
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
};

export type WorldEffect =
  | { type: 'belief.recorded'; id: Id; actorId: Id; text: string }
  | { type: 'information.shared'; id: Id; recipientActorId: Id; sourceMessageId: Id; quote: string }
  | { type: 'appointment.proposed'; id: Id; title: string; at: string; participantIds: Id[] }
  | { type: 'message.received'; id: Id; actorId: Id; text: string }
  | { type: 'appointment.created'; id: Id; title: string; at: string; participantIds: Id[] }
  | { type: 'fact.established'; id: Id; text: string; visibility: Visibility }
  | { type: 'media.requested'; id: Id; prompt: string; title?: string }
  | { type: 'choice.recorded'; id: Id; quote: string; intent: string }
  | { type: 'choice.next_step'; id: Id; choiceId: Id; quote: string }
  | { type: 'choice.recovery_step'; id: Id; choiceId: Id; quote: string }
  | {
      type: 'choice.result_reported';
      id: Id;
      choiceId: Id;
      quote: string;
      outcome: 'reported_done' | 'blocked' | 'abandoned';
    };

export type TurnProposal = { schemaVersion: 1; effects: WorldEffect[] };
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
  };
};
export type OutboxJob = {
  id: Id;
  worldId: Id;
  eventId: Id;
  type: 'image.generate';
  requestId: Id;
  prompt: string;
  /** Optional human-facing label for reminder-style jobs. */
  title?: string;
};
export type CommitResult = { state: WorldState; event: WorldEvent };
