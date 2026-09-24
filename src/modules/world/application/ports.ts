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
  actor: WorldState['actors'][number];
  facts: WorldState['facts'];
  messages: WorldState['messages'];
  appointments: WorldState['appointments'];
  retrievedMemories?: MemoryRecord[];
};
/** A character model only receives a filtered context, never the complete world. */
export interface TurnPlanner {
  propose(input: { context: ActorContext; userText: string }): Promise<unknown>;
}

/** The story clock and the beats already produced. Implemented in infrastructure. */
export type ClockStore = {
  read(ownerId: string, worldId: string): Promise<import('../domain/clock.ts').WorldClock>;
  write(
    ownerId: string,
    worldId: string,
    clock: import('../domain/clock.ts').WorldClock,
  ): Promise<void>;
  setStoryTime(ownerId: string, worldId: string, storyNow: string): Promise<void>;
  /** The user's own time controls: pause/resume and speed. */
  setClock(ownerId: string, worldId: string, input: { paused?: boolean; speed?: number }): Promise<void>;
  recordBeat(
    ownerId: string,
    worldId: string,
    beat: { id: string; commandId: string; plannedFor: string; actorId: string; status: string },
  ): Promise<void>;
};
