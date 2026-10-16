/** Internal preparation only. Public command bodies never receive compiler output or raw drafts. */
export type PublicationWorldOrigin = {
  workId: string;
  publicationVersion: number;
  draftVersion: number;
  contentHash: string;
};
export type PublicationWorldPrepare = {
  content: unknown;
  origin: PublicationWorldOrigin;
  originKind: 'published_work' | 'trial';
  worldId: string;
  ownerId: string;
  seedId: string;
};
/** Root's server-only adapter converts Q's deterministic compiler result to {world, opening, seed}.
 * All three remain untrusted until the repository validates identity, source and v0 structure.
 */
export interface PublicationWorldCompilerPort {
  prepare(input: PublicationWorldPrepare): unknown | Promise<unknown>;
}
