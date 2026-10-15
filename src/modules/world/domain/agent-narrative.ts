/** Explicit admission, not permission to restart any pre-existing life's opening. */
export type NarrativeAdmission = {
  worldId: string;
  engineEpoch: number;
  kind: 'new_genesis';
  genesisHash: string;
  admittedAtVersion: 0;
};
export type DirectorEvaluationCause = {
  id: string;
  kind: 'bootstrap';
  genesisHash: string;
  admittedAtVersion: 0;
};
/** Private to this NPC. A consideration request is neither a world fact nor a goal. */
export type EpisodeConsiderationIntent = {
  type: 'npc_episode_consideration';
  requestId: string;
  revision: 0;
  activity: 'conversation' | 'meeting' | 'follow_up';
  placeOptionIds: string[];
  basisSourceIds: string[];
};
export type EpisodeParticipationDecision = {
  requestId: string;
  choice: 'engage' | 'decline' | 'defer' | 'need_information' | 'quiet';
  reason: string;
  sourceIds: string[];
};
/** NPC-owned durable stance; source-backed and separate from player decisions. */
export type ActorEpisodeParticipation = {
  /** The stable consideration request ID, not another actor's identity. */
  id: string;
  choice: EpisodeParticipationDecision['choice'];
  reason: string;
  sourceIds: string[];
  recordedAtVersion: number;
};
/** Durable delivery state, distinct from the shared event's actual progress. */
export type AgentEpisodeRequest = {
  schemaVersion: 1;
  worldId: string;
  actorId: string;
  id: string;
  episodeId: string;
  originDecisionId: string;
  engineEpoch: number;
  createdAtVersion: number;
  activity: EpisodeConsiderationIntent['activity'];
  status: 'pending' | 'consumed';
  inputReceiptId: string | null;
  receiptId: string | null;
};
/** Only an actual committed NPC evaluation produces this receipt. */
export type AgentEpisodeReceipt = {
  schemaVersion: 1;
  worldId: string;
  actorId: string;
  id: string;
  requestId: string;
  episodeId: string;
  attemptId: string;
  inputReceiptId: string;
  sourceEventId: string;
  worldVersion: number;
  choice: EpisodeParticipationDecision['choice'] | 'unassessed';
  reason: string | null;
  sourceIds: string[];
  presentedMessageIds: string[];
};
