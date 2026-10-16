import type { EpisodeEvidenceRecord } from './episode-evidence.ts';

/** A sourced milestone, never an authority to finish the shared story. No other actor's state. */
export type ActorEpisodeResultContext = {
  evidenceId: string;
  episodeId: string;
  actorId: string;
  kind: EpisodeEvidenceRecord['kind'];
  subject: EpisodeEvidenceRecord['subject'];
  sourceEventId: string;
  worldVersion: number;
  occurredAt: string;
  overallOutcome: 'not_certified';
};
