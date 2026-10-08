import type { MemoryRecord } from '../../memory/domain/types.ts';
import type { WorldState } from '../domain/types.ts';
import type {
  SceneSession,
  SceneAction,
  SceneEntry,
  CurrentMatter,
} from '../domain/experience-rules.ts';
export type ScenePlanningContext = {
  world: WorldState;
  memoriesByActor?: Record<string, MemoryRecord[]>;
  blockedSourcesByActor?: Record<string, string[]>;
  scene: SceneSession;
  entries: SceneEntry[];
  matters: CurrentMatter[];
  action?: SceneAction;
  storyAt: string;
  appointmentTitle: string;
};
export type SceneProposal = {
  location: string;
  narration: string;
  presentActorIds: string[];
  outcome: 'succeeded' | 'failed' | 'partial' | null;
  observation: string | null;
  matterTitle: string | null;
  matterUpdates: { id: string; status: 'in_progress' | 'blocked' | 'completed' }[];
  dialogues: { actorId: string; text: string }[];
};
export interface ScenePlannerPort {
  propose(context: ScenePlanningContext, signal?: AbortSignal): Promise<SceneProposal>;
}
