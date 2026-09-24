/** Persisted contracts are versioned; timestamps are ISO 8601, all instants UTC. */
export type Id = string;
export type Session = { userId: Id };
export type Visibility = { kind: 'owner' } | { kind: 'actors'; actorIds: Id[] } | { kind: 'world' };

export type Actor = { id: Id; name: string; persona: string; relationship?: string };
export type Fact = {
  id: Id;
  text: string;
  visibility: Visibility;
  sourceEventId: Id;
  /** Absent only for legacy records; absence must not be interpreted as confirmed truth. */
  kind?: 'canonical' | 'belief';
  believedByActorId?: Id;
};
export type Message = {
  id: Id;
  actorId: Id;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  sourceEventId: Id;
};
export type Appointment = {
  /** Legacy records have no explicit response state. */
  status?: 'proposed' | 'confirmed' | 'cancelled';
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
  status: 'pending';
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

export type WorldState = {
  schemaVersion: 1;
  id: Id;
  ownerId: Id;
  version: number;
  title: string;
  time: string;
  actors: Actor[];
  facts: Fact[];
  messages: Message[];
  appointments: Appointment[];
  mediaRequests: MediaRequest[];
  /** Absent means no persisted notes yet; opening notes come from the build snapshot. */
  notes?: Note[];
};

export type WorldEffect =
  | { type: 'belief.recorded'; id: Id; actorId: Id; text: string }
  | { type: 'appointment.proposed'; id: Id; title: string; at: string; participantIds: Id[] }
  | { type: 'message.received'; id: Id; actorId: Id; text: string }
  | { type: 'appointment.created'; id: Id; title: string; at: string; participantIds: Id[] }
  | { type: 'fact.established'; id: Id; text: string; visibility: Visibility }
  | { type: 'media.requested'; id: Id; prompt: string; title?: string };

export type TurnProposal = { schemaVersion: 1; effects: WorldEffect[] };
export type TurnCommand = {
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
  type: 'turn.resolved';
  data: { actorId: Id; userText: string; effects: WorldEffect[] };
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
