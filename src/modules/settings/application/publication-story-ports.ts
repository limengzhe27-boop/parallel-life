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
  editorialIntent: string;
  intent:
    | { kind: 'offer_message'; actorKey: string; text: string }
    | {
        kind: 'offer_invitation';
        actorKeys: string[];
        placeKey: string;
        title: string;
        earliestAt: string;
      };
  origin: StoryOrigin;
};
export type PublicationStoryPrepare =
  | { status: 'claimed'; claim: PublicationStoryClaim }
  | { status: 'none' | 'busy' | 'unknown' | 'rate_limited'; pendingClaimId?: string };
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
export interface PublicationStoryPort {
  prepare(
    ownerId: string,
    worldId: string,
    options?: { automatic?: boolean },
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
