import { createHash, randomUUID } from 'node:crypto';
import { compilePublicationGenesis } from '../modules/settings/infrastructure/publication-genesis.ts';
import type { PublicationWorldCompilerPort } from '../modules/settings/application/publication-world-ports.ts';
import type { PublicationReviewPort } from '../modules/settings/infrastructure/publication-repository.ts';
import { TaskError } from '../modules/tasks/infrastructure/task-repository.ts';
import { publicationArt } from '../contracts/publication-assets.ts';
export const publicationWorldCompiler: PublicationWorldCompilerPort = {
  prepare(input) {
    const compiled = compilePublicationGenesis({
      ...input,
      originKind: input.originKind === 'trial' ? 'trial' : 'published',
      newId: randomUUID,
    });
    if (compiled.status !== 'compiled') throw new TaskError('INVALID_STATE');
    return {
      world: compiled.world,
      opening: compiled.opening,
      seed: {
        id: input.seedId,
        createdAt: new Date().toISOString(),
        source: { kind: compiled.seedMetadata.source, ...input.origin },
        identity: compiled.opening.identity,
        situation: compiled.opening.situation,
        setting: compiled.opening.setting,
        experienceNote: compiled.opening.experienceNote,
      },
    };
  },
};
/** Evidence comes from persisted trial events, never initial scripted messages or browser flags. */
export function publicationReview(
  evidence: (
    workId: string,
    version: number,
    hash: string,
  ) => Promise<{ verified: boolean; receiptId: string | null }>,
): PublicationReviewPort {
  return {
    async review(input) {
      const compiled = compilePublicationGenesis({
        content: input.content,
        originKind: 'trial',
        origin: {
          workId: input.workId,
          publicationVersion: 0,
          draftVersion: input.draftVersion,
          contentHash: input.contentHash,
        },
        worldId: randomUUID(),
        ownerId: randomUUID(),
        seedId: randomUUID(),
        newId: randomUUID,
      });
      const mediaVerified =
        input.content.media.every(
          (m) => (m.use === 'avatar' || m.use === 'cover') && Boolean(publicationArt(m, m.use)),
        ) &&
        input.content.phone.album.length === 0 &&
        input.content.places.every((p) => !p.sceneMediaKey);
      const trial = await evidence(input.workId, input.draftVersion, input.contentHash);
      return {
        reviewerVersion: 'publication_story_media_v2',
        runtimeCapabilities: new Set(compiled.status === 'compiled' ? compiled.capabilities : []),
        media: {
          verified: mediaVerified,
          manifestHash: mediaVerified
            ? createHash('sha256')
                .update(
                  input.content.media.length
                    ? JSON.stringify(
                        input.content.media
                          .map((m) => publicationArt(m, m.use as 'avatar' | 'cover')?.sha256)
                          .sort(),
                      )
                    : 'empty-publication-media-manifest-v1',
                )
                .digest('hex')
            : null,
        },
        trial,
      };
    },
  };
}
