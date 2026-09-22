/** Persisted contracts are versioned; timestamps are ISO 8601, all instants UTC. */
export type Id = string;
export type Session = { userId: Id };
export type Visibility =
  | { kind: 'owner' }
  | { kind: 'actors'; actorIds: Id[] }
  | { kind: 'world' };

export type Actor = { id: Id; name: string; persona: string };
export type Fact = { id: Id; text: string; visibility: Visibility; sourceEventId: Id };
export type Message = { id: Id; actorId: Id; role: 'user' | 'assistant'; text: string; at: string; sourceEventId: Id };
export type Appointment = { id: Id; title: string; at: string; participantIds: Id[]; sourceEventId: Id };
export type MediaRequest = { id: Id; prompt: string; status: 'pending'; sourceEventId: Id };

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
};

export type WorldEffect =
  | { type: 'message.received'; id: Id; actorId: Id; text: string }
  | { type: 'appointment.created'; id: Id; title: string; at: string; participantIds: Id[] }
  | { type: 'fact.established'; id: Id; text: string; visibility: Visibility }
  | { type: 'media.requested'; id: Id; prompt: string };

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
export type OutboxJob = { id: Id; worldId: Id; eventId: Id; type: 'image.generate'; requestId: Id; prompt: string };
export type CommitResult = { state: WorldState; event: WorldEvent };
