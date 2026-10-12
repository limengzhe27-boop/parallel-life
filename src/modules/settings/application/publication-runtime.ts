import type { WorldState } from '../../world/domain/types.ts';

/** Server-supplied publication identity; compilation does not prove a persisted binding. */
export type PublicationRuntimeOrigin = {
  workId: string;
  publicationVersion: number;
  draftVersion: number;
  contentHash: string;
};
export type PublicationOpeningMetadata = {
  kind: 'publication_opening';
  schemaVersion: 1;
  origin: PublicationRuntimeOrigin;
  originKind: 'published' | 'trial';
  identity: string;
  situation: string;
  setting: string;
  experienceNote: string;
  contacts: {
    actorKey: string;
    actorId: string;
    name: string;
    relationship: string;
    identity?: string;
    traits: string[];
    appearance?: string;
  }[];
  /** Authored player-known notes, not a player's save command or persisted Note projection. */
  notes: {
    key: string;
    id: string;
    title: string;
    text: string;
    sourceEventId: string;
    factKeys: string[];
  }[];
};
export type PublicationGenesisKeys = {
  actors: { key: string; id: string }[];
  messages: { key: string; id: string }[];
  history: { key: string; occurredAt: string; ownerFactId?: string; actorFactId?: string }[];
  invitations: { key: string; id: string }[];
  notes: { key: string; id: string }[];
  routes: { fromPlaceKey: string; toPlaceKey: string; id: string }[];
};
export type PublicationCompileIssue = { code: string; path: (string | number)[] };
export type PublicationCompileInput = {
  originKind: 'published' | 'trial';
  content: unknown;
  origin: PublicationRuntimeOrigin;
  worldId: string;
  ownerId: string;
  seedId: string;
  /** Caller-owned allocation. The compiler owns no clock, random generator, database or model. */
  newId: () => string;
};
export type PublicationCompileResult =
  | {
      status: 'compiled';
      world: WorldState;
      opening: PublicationOpeningMetadata;
      keys: PublicationGenesisKeys;
      origin: PublicationRuntimeOrigin;
      seedMetadata: {
        source: 'published_work' | 'publication_trial';
        origin: PublicationRuntimeOrigin;
      };
      capabilities: ['publication.opening.v1'];
    }
  | { status: 'invalid' | 'unsupported'; issues: PublicationCompileIssue[]; capabilities: [] };
export interface PublicationRuntimeCompiler {
  compile(input: PublicationCompileInput): PublicationCompileResult;
}
