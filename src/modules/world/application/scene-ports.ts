import type { SceneStepProposal, SceneNpcActionProposal } from '../domain/matters.ts';
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
  /** Only this sourced invitation; no future nodes or private character profiles. */
  currentOfferBrief?: {
    editorialIntent: string;
    actorIds: string[];
    placeId: string;
    placeName: string;
    invitationId: string;
    sourceEventId: string;
  } | null;
};
export type SceneProposal = {
  location: string;
  narration: string;
  presentActorIds: string[];
  outcome: 'succeeded' | 'failed' | 'partial' | null;
  observation: string | null;
  /** Legacy single-title output remains readable; no per-scene task-count product rule. */
  matterTitle: string | null;
  initialMatters?: { title: string }[];
  matterUpdates: { id: string; status: 'in_progress' | 'blocked' | 'completed' }[];
  dialogues: { actorId: string; text: string; delivery?: string }[];
  /** Candidates only. The runtime validates and owns saved step/action evidence. */
  stepProposals?: SceneStepProposal[];
  npcActions?: SceneNpcActionProposal[];
};
export interface ScenePlannerPort {
  propose(context: ScenePlanningContext, signal?: AbortSignal): Promise<SceneProposal>;
}
