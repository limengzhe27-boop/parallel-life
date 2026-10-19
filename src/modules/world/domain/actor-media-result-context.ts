/** Actual media completion is separate from the earlier successful enqueue action. */
export type ActorMediaExecutionRef = {
  worldId: string;
  actorId: string;
  actionId: string;
  enqueueResultId: string;
  requestId: string;
  sourceEventId: string;
  sourceWorldVersion: number;
  requestedAtStory: string;
  mediaType: 'image' | 'video';
};
export type ActorMediaResultContext = ActorMediaExecutionRef & {
  /** Stable semantic identity for source authentication and later original wake/ACK binding. */
  id: string;
  phase: 'completed';
  asset: { id: string; revision: number; mimeType: string };
  provenance: { taskId: string; taskResultVersion: number; outboxId: string };
  /** Real worker commit time, NOT a simulation timestamp or when the NPC learned it. */
  completedAtReal: string;
  source: {
    id: string;
    recordId: string;
    contentHash: string;
    sourceEventId: string;
    sourceWorldVersion: number;
    /** Original lineage anchor; never described as the time generation finished. */
    sourceStoryAt: string;
  };
  /** Existing source-linked assistant messages can project the asset; this is NOT a client read receipt. */
  chatProjection: { status: 'eligible' | 'suppressed' | 'no_message'; messageIds: string[] };
};
export type ActorMediaPendingContext = ActorMediaExecutionRef & {
  phase: 'queued' | 'unknown' | 'failed' | 'unverified_ready';
};
export type ActorMediaResultView = {
  completed: ActorMediaResultContext[];
  pending: ActorMediaPendingContext[];
};
