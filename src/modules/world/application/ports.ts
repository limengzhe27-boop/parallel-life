import type {
  CommitResult,
  Session,
  TurnCommand,
  WorldEvent,
  WorldState,
} from '../domain/types.ts';

import type { MemoryRecord } from '../../memory/domain/types.ts';

/** Implementations MUST authorize reads and atomically commit state/event/jobs/receipt. */
export interface WorldRepository {
  get(session: Session, worldId: string): Promise<WorldState>;
  receipt(session: Session, command: TurnCommand): Promise<CommitResult | null>;
  commit(session: Session, command: TurnCommand, event: WorldEvent): Promise<CommitResult>;
}
export type ActorContext = {
  worldId: string;
  worldVersion: number;
  time: string;
  worldTitle?: string;
  actor: WorldState['actors'][number];
  facts: WorldState['facts'];
  messages: WorldState['messages'];
  appointments: WorldState['appointments'];
  retrievedMemories?: MemoryRecord[];
  turnOrigin?: 'director';
};
/** A character model only receives a filtered context, never the complete world. */
export interface TurnPlanner {
  propose(input: { context: ActorContext; userText: string }): Promise<unknown>;
}

/** The story clock and the beats already produced. Implemented in infrastructure. */
export type ClockStore = {
  beatCommandId(worldId: string, plannedFor: string): string;
  /** One director may advance a world at a time, including the model call. */
  withAdvanceLock<T>(worldId: string, run: () => Promise<T>): Promise<T>;
  read(ownerId: string, worldId: string): Promise<import('../domain/clock.ts').WorldClock>;
  ensureAnchor(
    ownerId: string,
    worldId: string,
    clock: import('../domain/clock.ts').WorldClock,
  ): Promise<void>;
  write(
    ownerId: string,
    worldId: string,
    clock: import('../domain/clock.ts').WorldClock,
  ): Promise<void>;
  setStoryTime(ownerId: string, worldId: string, storyNow: string): Promise<void>;
  /** The user's own time controls: pause/resume and speed. */
  setClock(
    ownerId: string,
    worldId: string,
    input: { paused?: boolean; speed?: number },
  ): Promise<void>;
  recordBeat(
    ownerId: string,
    worldId: string,
    beat: { id: string; commandId: string; plannedFor: string; actorId: string; status: string },
  ): Promise<void>;
  committedBeat(ownerId: string, worldId: string, commandId: string): Promise<string | null>;
  recentActors(ownerId: string, worldId: string, sinceStoryAt: string): Promise<string[]>;
  hasUnresolvedAttempt(ownerId: string, worldId: string): Promise<boolean>;
  beginAttempt(
    ownerId: string,
    worldId: string,
    attempt: { commandId: string; plannedFor: string; actorId: string },
    allowRetry: boolean,
  ): Promise<boolean>;
  markAttempt(
    ownerId: string,
    worldId: string,
    commandId: string,
    status: 'committed' | 'unknown',
  ): Promise<void>;
  finishAdvance(
    ownerId: string,
    worldId: string,
    clock: import('../domain/clock.ts').WorldClock,
  ): Promise<void>;
};

/** The user's brief for the director of one life (L-03). */
export type DirectionStore = {
  read(ownerId: string, worldId: string): Promise<import('../domain/direction.ts').WorldDirection>;
  write(
    ownerId: string,
    worldId: string,
    direction: import('../domain/direction.ts').WorldDirection,
  ): Promise<void>;
};
