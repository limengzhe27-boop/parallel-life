import type { StoryWorldInput } from './types.ts';

/** Director-only observations of committed world records, never an NPC knowledge packet. */
export type DirectorObservation = {
  worldVersion: number;
  storyAt: string;
  recentWorldInputs: StoryWorldInput[];
  eventProgress?: {
    nodeKey: string;
    phase: 'introduced' | 'engaged' | 'resolved';
    resolution: string | null;
    sourceEventId: string;
    sourceVersion: number;
    actors: {
      actorId: string;
      participation: 'unknown' | 'engaged' | 'declined';
      status: 'active' | 'deferred' | 'fulfilled' | 'withdrawn';
    }[];
  }[];
  actorExchanges: {
    actorId: string;
    sourceEventId: string;
    sourceVersion: number;
    at: string;
    origin: 'user' | 'director';
    /** An assertion or request, never proof of an executed physical action. */
    playerText: string | null;
    actorText: string;
  }[];
};
