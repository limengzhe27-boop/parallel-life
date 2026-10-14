import type {
  NextStoryMove,
  StoryEventProgress,
  ownGoalBrief,
} from '../domain/story-event-progress.ts';
import type { StoryOrigin, StoryStatus } from '../domain/publication-story.ts';
export type PublicationStoryClaim = {
  claimId: string;
  nodeKey: string;
  commandId: string;
  expectedVersion: number;
  actorId: string;
  actorKey: string;
  placeId: string | null;
  placeName: string | null;
  placeDescription?: string | null;
  placeNeedsReveal?: boolean;
  editorialIntent: string;
  script?: string;
  sceneText?: string;
  places?: { key: string; name: string; description?: string }[];
  intent:
    | { kind: 'director_event'; actorKey?: string }
    | { kind: 'offer_message'; actorKey: string; text: string }
    | {
        kind: 'offer_invitation';
        actorKeys: string[];
        placeKey: string;
        title: string;
        earliestAt: string;
      };
  origin: StoryOrigin;
  /** Current own goal/progress only; neither other actors' private goals nor future steps. */
  eventProgress?: PublicationEventProgressContext;
};
export type PublicationStoryPrepare =
  | { status: 'claimed'; claim: PublicationStoryClaim }
  | {
      status: 'none' | 'busy' | 'unknown' | 'rate_limited';
      /** False only for a world with no story sidecar; a managed wait must not run generic auto-director. */
      managed?: boolean;
      pendingClaimId?: string;
    };
/** Only already presented source references, active stage keys and a pending opaque receipt are public. */
export type PublicationStoryProgress = {
  currentStageKeys: string[];
  totalNodes: number;
  presented: {
    nodeKey: string;
    status: StoryStatus;
    outcome: 'committed' | 'declined' | 'skipped' | 'expired' | null;
    sourceEventId: string;
    sourceMessageId: string | null;
    invitationId: string | null;
    playerCompleted: false;
  }[];
  pending: { claimId: string; commandId: string; status: 'claimed' | 'unknown' } | null;
};
export type PublicationSceneBrief = {
  nodeKey: string;
  editorialIntent: string;
  actorIds: string[];
  placeId: string;
  placeName: string;
  invitationId: string;
  sourceEventId: string;
};
export type PublicationEventProgressContext = {
  nodeKey: string;
  actorId: string;
  phase: StoryEventProgress['phase'];
  resolution: StoryEventProgress['resolution'];
  ownGoal: NonNullable<ReturnType<typeof ownGoalBrief>>;
  productiveBeats: number;
  segmentIndex: number;
  nextMove: NextStoryMove;
};
export type PublicationStoryOpportunities = {
  managed: boolean;
  directorPool: boolean;
  version: number;
  storyNow: string;
  worldSetting?: string;
  candidates: {
    nodeKey: string;
    title: string;
    editorialIntent: string;
    actorId?: string;
    actorOptions?: { id: string; key: string; name: string }[];
    places?: { key: string; name: string; description?: string }[];
    placeName: string | null;
    placeDescription?: string | null;
    direction?: { mode: 'required' | 'optional'; expectedImpact?: string; experience?: string };
    /** A continuation is never a new opening or a forced player action. */
    eventProgress?: PublicationEventProgressContext;
  }[];
};
export interface PublicationStoryPort {
  eventProgressContext?(
    ownerId: string,
    worldId: string,
    actorId: string,
  ): Promise<PublicationEventProgressContext[]>;
  prepareProgressBeat?(
    ownerId: string,
    worldId: string,
    nodeKey: string,
    options: { expectedVersion: number; automatic: boolean },
  ): Promise<PublicationStoryPrepare>;
  finishProgressBeat?(
    ownerId: string,
    worldId: string,
    claimId: string,
  ): Promise<PublicationStoryProgress>;

  /** Server-only eligible pool. Never return author intents through player progress. */
  opportunities?(
    ownerId: string,
    worldId: string,
    automatic: boolean,
  ): Promise<PublicationStoryOpportunities>;
  beginSelection?(
    ownerId: string,
    worldId: string,
    version: number,
    attemptId: string,
    candidateKeys: string[],
  ): Promise<boolean>;
  finishSelection?(
    ownerId: string,
    worldId: string,
    attemptId: string,
    status: 'selected' | 'deferred' | 'unknown',
    nodeKey: string | null,
  ): Promise<void>;
  invitationContext?(
    ownerId: string,
    worldId: string,
    actorId: string,
  ): Promise<{ title: string; placeName: string | null; earliestAt: string } | null>;
  prepare(
    ownerId: string,
    worldId: string,
    options?: { automatic?: boolean; nodeKey?: string; expectedVersion?: number; actorId?: string },
  ): Promise<PublicationStoryPrepare>;
  finish(ownerId: string, worldId: string, claimId: string): Promise<PublicationStoryProgress>;
  progress(ownerId: string, worldId: string): Promise<PublicationStoryProgress>;
  skip(
    ownerId: string,
    worldId: string,
    nodeKey: string,
    commandId: string,
  ): Promise<PublicationStoryProgress>;
  retry(ownerId: string, worldId: string, claimId: string): Promise<PublicationStoryPrepare>;
  sceneBrief(
    ownerId: string,
    worldId: string,
    invitationId: string,
  ): Promise<PublicationSceneBrief | null>;
  invitationLinks(
    ownerId: string,
    worldId: string,
  ): Promise<{ invitationId: string; placeId: string; placeName: string; sourceEventId: string }[]>;
}
