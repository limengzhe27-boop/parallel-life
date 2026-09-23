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
